const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authMiddleware } = require("../middlewares/authMiddleware");
const Leave = require("../../models/Leave");
const LeaveSlot = require("../../models/LeaveSlot");
const User = require("../../models/User");
const Organization = require("../../models/Organization");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../../../public/uploads/");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// 1. [출타 심의] 휴가 슬롯 부여
router.post(
  "/leave-slots",
  authMiddleware,
  upload.single("evidenceFile"),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { type, totalCount, reason, expiresAt } = req.body;
      const evidenceFile = req.file ? `/uploads/${req.file.filename}` : null;

      const newSlot = await LeaveSlot.create({
        organizationId: req.user.orgId,
        userId: userId,
        unitId: req.user.unitId || req.user.orgId,
        type,
        reason,
        totalCount: Number(totalCount),
        remains: Number(totalCount),
        grantedBy: req.user.userId,
        evidenceFile: evidenceFile,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });

      res.json({
        success: true,
        message: "출타 심의가 완료되어 휴가가 부여되었습니다.",
        slot: newSlot,
      });
    } catch (error) {
      res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

// 2. [출타 신청용] '내' 남은 휴가 슬롯 조회
router.get("/leave-slots/me", authMiddleware, async (req, res) => {
  try {
    const slots = await LeaveSlot.find({
      userId: req.user.userId,
      remains: { $gt: 0 },
      status: "active",
    }).sort({ expiresAt: 1, createdAt: 1 });
    res.json({ slots });
  } catch (error) {
    res.status(500).json({ error: "슬롯 조회 실패" });
  }
});

// 3. [출타 신청]
router.post("/leaves", authMiddleware, async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      destination,
      emergencyContact,
      reason,
      usedSlots,
    } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysUsed = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    if (!usedSlots || usedSlots.length === 0)
      return res
        .status(400)
        .json({ error: "사용할 휴가가 할당되지 않았습니다." });

    const totalSlotQty = usedSlots.reduce((sum, slot) => sum + slot.qty, 0);
    if (totalSlotQty !== daysUsed)
      return res
        .status(400)
        .json({ error: "신청 일수와 할당된 휴가 일수가 일치하지 않습니다." });

    for (const us of usedSlots) {
      const slot = await LeaveSlot.findById(us.slotId);
      if (!slot || slot.userId.toString() !== userId || slot.remains < us.qty) {
        return res
          .status(400)
          .json({
            error: "유효하지 않거나 잔여일이 부족한 휴가가 포함되어 있습니다.",
          });
      }
      slot.remains -= us.qty;
      await slot.save();
    }

    let initialStatus = "PENDING_REVIEW";
    if (userRole === "officer" || userRole === "reviewer")
      initialStatus = "PENDING_APPROVAL";

    const newLeave = await Leave.create({
      organizationId: req.user.orgId,
      userId,
      unitId: req.user.unitId || req.user.orgId,
      startDate,
      endDate,
      totalDaysUsed: daysUsed,
      usedSlots: usedSlots,
      reason: `${reason} (행선지: ${destination}, 연락처: ${emergencyContact})`,
      status: initialStatus,
    });

    res.json({
      success: true,
      message: "성공적으로 출타 신청이 완료되었습니다.",
      leave: newLeave,
    });
  } catch (error) {
    res.status(500).json({ error: "출타 신청 중 오류가 발생했습니다." });
  }
});

// 4. [달력 렌더링용] 개인 휴가 조회
router.get("/leaves/my", authMiddleware, async (req, res) => {
  try {
    const leaves = await Leave.find({
      userId: req.user.userId,
      status: { $ne: "CANCELLED" },
    }).populate("userId", "name rank serviceNumber");

    const mappedLeaves = leaves.map((l) => ({
      _id: l._id,
      startDate: l.startDate,
      endDate: l.endDate,
      type: "휴가",
      userId: l.userId,
      status: l.status,
      reason: l.reason,
      totalDaysUsed: l.totalDaysUsed, // 🔥 이거 추가됨
    }));
    res.json({ leaves: mappedLeaves });
  } catch (error) {
    res.status(500).json({ error: "개인 휴가 조회 실패" });
  }
});

// 5. [달력 렌더링용] 전체 휴가 조회
router.get("/leaves/all", authMiddleware, async (req, res) => {
  try {
    const { role, orgId } = req.user;
    if (role === "soldier" || role === "officer")
      return res.status(403).json({ error: "권한이 없습니다." });

    const leaves = await Leave.find({
      organizationId: orgId,
      status: { $ne: "CANCELLED" },
    }).populate("userId", "name rank serviceNumber");

    const mappedLeaves = leaves.map((l) => ({
      _id: l._id,
      startDate: l.startDate,
      endDate: l.endDate,
      type: "휴가",
      userId: l.userId,
      status: l.status,
      reason: l.reason,
      totalDaysUsed: l.totalDaysUsed, // 🔥 이거 추가됨
    }));
    res.json({ leaves: mappedLeaves });
  } catch (error) {
    res.status(500).json({ error: "전체 휴가 조회 실패" });
  }
});

// 6. [알림용 종합 라우트]
router.get("/leaves/notifications", authMiddleware, async (req, res) => {
  try {
    const { role, orgId, userId } = req.user;

    const currentUser = await User.findById(userId);
    if (!currentUser)
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });

    const currentOrg = await Organization.findById(orgId);

    let queries = [];
    if (role === "reviewer")
      queries.push({ organizationId: orgId, status: "PENDING_REVIEW" });
    else if (role === "approver")
      queries.push({ organizationId: orgId, status: "PENDING_APPROVAL" });

    queries.push({
      userId: userId,
      status: { $in: ["REJECTED_REVIEW", "REJECTED_APPROVAL"] },
    });

    let notifications = [];
    if (queries.length > 0) {
      notifications = await Leave.find({ $or: queries })
        .populate("userId", "name rank serviceNumber")
        .sort({ createdAt: -1 });
    }

    const userInfo = {
      name: currentUser.name,
      role: currentUser.role,
      unitName: currentOrg ? currentOrg.name : "소속 부대",
    };

    res.json({ notifications, userInfo });
  } catch (error) {
    res.status(500).json({ error: "알림 조회 실패" });
  }
});

// 7. 휴가 거절 처리
router.put("/leaves/:id/reject", authMiddleware, async (req, res) => {
  try {
    const { role } = req.user;
    if (!["reviewer", "approver"].includes(role))
      return res.status(403).json({ error: "권한이 없습니다." });

    const leave = await Leave.findById(req.params.id);
    if (!leave)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });

    leave.status =
      role === "reviewer" ? "REJECTED_REVIEW" : "REJECTED_APPROVAL";

    for (const us of leave.usedSlots) {
      const slot = await LeaveSlot.findById(us.slotId);
      if (slot) {
        slot.remains += us.qty;
        await slot.save();
      }
    }
    await leave.save();
    res.json({
      success: true,
      message: "거절 처리 및 휴가 일수가 반환되었습니다.",
    });
  } catch (error) {
    res.status(500).json({ error: "거절 처리 실패" });
  }
});

// 8. 거절 알림 확인
router.put("/leaves/:id/confirm-reject", authMiddleware, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    if (!leave)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });
    leave.status = "CANCELLED";
    await leave.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "확인 실패" });
  }
});

// 9. 휴가 검토 완료 처리
router.put("/leaves/:id/review", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "reviewer")
      return res.status(403).json({ error: "권한이 없습니다." });
    const leave = await Leave.findById(req.params.id);
    if (!leave)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });

    leave.status = "PENDING_APPROVAL";
    leave.reviewerId = req.user.userId;
    leave.reviewedAt = new Date();
    await leave.save();

    res.json({
      success: true,
      message: "검토가 완료되었습니다. 승인자에게 전달됩니다.",
    });
  } catch (error) {
    res.status(500).json({ error: "검토 처리 실패" });
  }
});

// 10. 휴가 최종 승인 처리
router.put("/leaves/:id/approve", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "approver")
      return res.status(403).json({ error: "권한이 없습니다." });
    const leave = await Leave.findById(req.params.id);
    if (!leave)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });

    leave.status = "APPROVED";
    leave.approverId = req.user.userId;
    leave.approvedAt = new Date();
    await leave.save();

    res.json({
      success: true,
      message: "최종 승인 완료. 달력에 즉시 반영됩니다.",
    });
  } catch (error) {
    res.status(500).json({ error: "승인 처리 실패" });
  }
});

module.exports = router;
