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
    const dir = path.join(__dirname, "../../public/uploads/");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

async function calculatePriorityScore(user, leaveType, leaveReason, startDate) {
  let score = 0;
  const now = new Date();
  const targetDate = new Date(startDate);

  const deadline = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth() - 1,
    1
  );
  if (now > deadline) {
    score -= 100000;
  }

  if (leaveType === "휴가") {
    if (leaveReason.includes("신병위로휴가")) score += 50000;
    if (user.dischargeDate) {
      const daysToDischarge =
        (new Date(user.dischargeDate) - targetDate) / (1000 * 60 * 60 * 24);
      if (daysToDischarge <= 60 && daysToDischarge > 0) score += 30000;
    }
  }

  if (leaveType === "외출" || leaveType === "외박") {
    if (leaveReason.includes("정기")) score += 10000;
  }

  const lastLeave = await Leave.findOne({
    userId: user._id,
    type: "휴가",
    status: { $in: ["APPROVED", "PENDING_APPROVAL", "PENDING_REVIEW"] },
  }).sort({ endDate: -1 });

  if (lastLeave) {
    const daysSinceLastLeave = Math.max(
      0,
      (now - new Date(lastLeave.endDate)) / (1000 * 60 * 60 * 24)
    );
    score += Math.floor(daysSinceLastLeave * 10);
  } else {
    score += 5000;
  }

  if (user.enlistmentDate) {
    const daysServed = Math.max(
      0,
      (now - new Date(user.enlistmentDate)) / (1000 * 60 * 60 * 24)
    );
    score += Math.floor(daysServed);
  }

  const totalLeavesTaken = await Leave.countDocuments({
    userId: user._id,
    status: { $in: ["APPROVED", "PENDING_APPROVAL", "PENDING_REVIEW"] },
  });
  score -= totalLeavesTaken * 50;

  return score;
}

// 🔥 [核心大腦 2] 重新計算候補引擎 (修正鎖定邏輯與日期洗牌範圍)
async function recalculateWaitlist(orgId, startDate, endDate) {
  const org = await Organization.findById(orgId);
  if (!org) return;

  const actualSoldierCount = await User.countDocuments({
    organizationId: orgId,
    role: "soldier",
    status: "approved",
  });

  const totalSoldiers = actualSoldierCount > 0 ? actualSoldierCount : 1;

  const defaultLimitLong = Math.floor(
    totalSoldiers * ((org.settings?.leaveRateLong || 20) / 100)
  );
  const defaultLimitShort = Math.floor(
    totalSoldiers * ((org.settings?.leaveRateShort || 15) / 100)
  );
  const specialRates = org.settings?.specialRates || [];

  const queryStart = new Date(startDate);
  const queryEnd = new Date(endDate);

  const overlappingLeaves = await Leave.find({
    organizationId: orgId,
    status: {
      $nin: [
        "CANCELLED",
        "REJECTED_REVIEW",
        "REJECTED_APPROVAL",
        "FORCE_CANCELLED",
      ],
    },
    $or: [{ startDate: { $lte: queryEnd }, endDate: { $gte: queryStart } }],
  }).populate("userId", "role");

  const soldierLeaves = overlappingLeaves.filter(
    (l) => l.userId && l.userId.role === "soldier"
  );

  if (soldierLeaves.length === 0) return;

  // 🔥 關鍵修復 1：把重算的日期範圍「無限擴張」到所有受影響假單的最大/最小日期！
  // 這樣解鎖 D 的時候，跨週末或長天數的 A、B、C 才會每一天都被重新正確計算。
  const minStart = new Date(
    Math.min(...soldierLeaves.map((l) => new Date(l.startDate)))
  );
  const maxEnd = new Date(
    Math.max(...soldierLeaves.map((l) => new Date(l.endDate)))
  );

  let waitlistFlags = {};
  soldierLeaves.forEach((l) => (waitlistFlags[l._id.toString()] = false));

  let iter = new Date(minStart);
  while (iter <= maxEnd) {
    const dStr = iter.toISOString().split("T")[0];
    const currentDayLeaves = soldierLeaves.filter(
      (l) => new Date(l.startDate) <= iter && new Date(l.endDate) >= iter
    );

    let limitLong = defaultLimitLong;
    let limitShort = defaultLimitShort;

    for (const sr of specialRates) {
      if (dStr >= sr.startDate && dStr <= sr.endDate) {
        limitLong = Math.floor(totalSoldiers * (sr.rateLong / 100));
        limitShort = Math.floor(totalSoldiers * (sr.rateShort / 100));
        break;
      }
    }

    const normalLongLeaves = currentDayLeaves.filter(
      (l) => l.type === "휴가" && !l.isManualOverride
    );
    const normalShortLeaves = currentDayLeaves.filter(
      (l) => (l.type === "외출" || l.type === "외박") && !l.isManualOverride
    );
    const manualLeaves = currentDayLeaves.filter((l) => l.isManualOverride);

    // 🔥 關鍵修復 2：鎖定的人(manualLeaves) 視為「特例外掛」，不去扣除基本名額！
    // 所以 limitLong 依然維持 3，原本的 A B C 就不會掉下來。
    let availableLimitLong = limitLong;
    let availableLimitShort = limitShort;

    manualLeaves.forEach((l) => (waitlistFlags[l._id.toString()] = false));

    normalLongLeaves.sort((a, b) => b.priorityScore - a.priorityScore);
    normalShortLeaves.sort((a, b) => b.priorityScore - a.priorityScore);

    normalLongLeaves.forEach((l, index) => {
      if (index >= availableLimitLong) waitlistFlags[l._id.toString()] = true;
    });
    normalShortLeaves.forEach((l, index) => {
      if (index >= availableLimitShort) waitlistFlags[l._id.toString()] = true;
    });

    iter.setDate(iter.getDate() + 1);
  }

  for (const leave of soldierLeaves) {
    const shouldBeWaitlisted = waitlistFlags[leave._id.toString()];
    let needsSave = false;

    if (leave.isWaitlisted !== shouldBeWaitlisted && !leave.isManualOverride) {
      leave.isWaitlisted = shouldBeWaitlisted;
      needsSave = true;
    }

    if (
      leave.isWaitlisted &&
      ["PENDING_APPROVAL", "APPROVED"].includes(leave.status)
    ) {
      leave.status = "PENDING_REVIEW";
      needsSave = true;
    }

    if (needsSave) {
      await leave.save();
    }
  }
}

router.post("/leave-slots", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    let { type, totalCount, reason, expiresAt } = req.body;

    if (type === "외박" && reason === "특별") {
      totalCount = 2;
      expiresAt = null;
    } else if (
      type === "외출" &&
      (reason === "평일특별" || reason === "주말특별")
    ) {
      expiresAt = null;
    } else if (type === "휴가" && reason === "기타휴가") {
      expiresAt = null;
    }

    const newSlot = await LeaveSlot.create({
      organizationId: req.user.orgId,
      userId: userId,
      unitId: req.user.unitId || req.user.orgId,
      type,
      reason,
      totalCount: Number(totalCount),
      remains: Number(totalCount),
      grantedBy: req.user.userId,
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
});

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

router.post(
  "/leaves",
  authMiddleware,
  upload.array("evidenceFiles", 5),
  async (req, res) => {
    try {
      const { startDate, endDate, destination, emergencyContact, reason } =
        req.body;
      const userId = req.user.userId;
      const userRole = req.user.role;

      let usedSlots = [];
      if (req.body.usedSlots) {
        usedSlots =
          typeof req.body.usedSlots === "string"
            ? JSON.parse(req.body.usedSlots)
            : req.body.usedSlots;
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

      const overlapping = await Leave.findOne({
        userId,
        status: {
          $nin: [
            "CANCELLED",
            "REJECTED_REVIEW",
            "REJECTED_APPROVAL",
            "FORCE_CANCELLED",
          ],
        },
        $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }],
      });

      if (overlapping)
        return res
          .status(400)
          .json({ error: "해당 기간에 이미 신청된 휴가가 있습니다." });

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

      let mainType = "휴가";
      for (const us of usedSlots) {
        const slot = await LeaveSlot.findById(us.slotId);
        if (
          !slot ||
          slot.userId.toString() !== userId ||
          slot.remains < us.qty
        ) {
          return res.status(400).json({
            error: "유효하지 않거나 잔여일이 부족한 휴가가 포함되어 있습니다.",
          });
        }
        mainType = slot.type;
        slot.remains -= us.qty;
        await slot.save();
      }

      let initialStatus = "PENDING_REVIEW";
      if (userRole === "officer" || userRole === "reviewer")
        initialStatus = "PENDING_APPROVAL";

      let evidenceFilesPaths = [];
      if (req.files && req.files.length > 0) {
        evidenceFilesPaths = req.files.map(
          (file) => `/uploads/${file.filename}`
        );
      }

      const currentUser = await User.findById(userId);
      const calculatedScore = await calculatePriorityScore(
        currentUser,
        mainType,
        reason,
        startDate
      );

      const newLeave = new Leave({
        organizationId: req.user.orgId,
        userId,
        unitId: req.user.unitId || req.user.orgId,
        type: mainType,
        startDate,
        endDate,
        totalDaysUsed: daysUsed,
        usedSlots: usedSlots,
        reason: `${reason} (행선지: ${destination}, 연락처: ${emergencyContact})`,
        status: initialStatus,
        evidenceFiles: evidenceFilesPaths,
        priorityScore: calculatedScore,
        isWaitlisted: false,
      });

      await newLeave.save();

      if (userRole === "soldier") {
        await recalculateWaitlist(req.user.orgId, startDate, endDate);
      }

      res.json({
        success: true,
        message: "성공적으로 출타 신청이 완료되었습니다.",
        leave: newLeave,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "출타 신청 중 오류가 발생했습니다." });
    }
  }
);

router.get("/leaves/my", authMiddleware, async (req, res) => {
  try {
    const leaves = await Leave.find({
      userId: req.user.userId,
      status: { $nin: ["CANCELLED"] },
    })
      .populate(
        "userId",
        "name rank serviceNumber role promoToIlbyung promoToSangbyung promoToByungjang"
      )
      .lean();
    const mappedLeaves = leaves.map((l) => ({
      _id: l._id,
      startDate: l.startDate,
      endDate: l.endDate,
      type: l.type || "휴가",
      userId: l.userId,
      status: l.status,
      reason: l.reason,
      totalDaysUsed: l.totalDaysUsed,
      isWaitlisted: l.isWaitlisted,
    }));
    res.json({ leaves: mappedLeaves });
  } catch (error) {
    res.status(500).json({ error: "개인 휴가 조회 실패" });
  }
});

router.get("/leaves/all", authMiddleware, async (req, res) => {
  try {
    const { role, orgId } = req.user;
    let query = { organizationId: orgId };

    if (role === "soldier") {
      query.status = {
        $in: [
          "APPROVED",
          "CANCEL_REQ_REVIEW",
          "CANCEL_REQ_APPROVAL",
          "CANCEL_APPROVED",
          "REJECTED_REVIEW",
          "REJECTED_APPROVAL",
          "FORCE_CANCELLED",
        ],
      };
    } else {
      query.status = {
        $nin: ["CANCELLED"],
      };
    }

    const leaves = await Leave.find(query)
      .populate(
        "userId",
        "name rank serviceNumber role promoToIlbyung promoToSangbyung promoToByungjang"
      )
      .lean();

    const mappedLeaves = leaves.map((l) => ({
      _id: l._id,
      startDate: l.startDate,
      endDate: l.endDate,
      type: l.type || "휴가",
      userId: l.userId,
      status: l.status,
      reason: l.reason,
      totalDaysUsed: l.totalDaysUsed,
      isWaitlisted: l.isWaitlisted,
      isManualOverride: l.isManualOverride,
      priorityScore: l.priorityScore,
    }));

    res.json({ leaves: mappedLeaves });
  } catch (error) {
    res.status(500).json({ error: "전체 휴가 조회 실패" });
  }
});

router.delete("/leaves/:id", authMiddleware, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });
    }

    if (
      leave.userId.toString() !== req.user.userId &&
      !["reviewer", "officer", "approver", "superadmin"].includes(req.user.role)
    ) {
      return res
        .status(403)
        .json({ error: "본인의 휴가만 취소할 수 있습니다." });
    }

    const { status, organizationId, startDate, endDate } = leave;

    if (status === "PENDING_REVIEW" || status === "PENDING_APPROVAL") {
      for (const us of leave.usedSlots) {
        const slot = await LeaveSlot.findById(us.slotId);
        if (slot) {
          slot.remains += us.qty;
          await slot.save();
        }
      }

      await Leave.findByIdAndDelete(req.params.id);
      await recalculateWaitlist(organizationId, startDate, endDate);

      return res.json({
        success: true,
        message: "휴가 신청이 취소되었으며, 사용된 일수가 즉시 반환되었습니다.",
      });
    } else if (status === "APPROVED") {
      leave.status = "CANCEL_REQ_REVIEW";
      await leave.save();

      return res.json({
        success: true,
        message:
          "이미 승인된 휴가입니다. 간부에게 '취소 요청'이 전달되었으며, 승인 후 일수가 반환됩니다.",
      });
    } else {
      return res.status(400).json({
        error:
          "현재 취소할 수 없는 상태입니다. (이미 취소 진행 중이거나 처리됨)",
      });
    }
  } catch (error) {
    console.error("🔥 Leave Delete Error:", error);
    res.status(500).json({ error: "휴가 취소 중 서버 오류가 발생했습니다." });
  }
});

router.put("/leaves/:id/reject", authMiddleware, async (req, res) => {
  try {
    const { role } = req.user;
    if (!["reviewer", "approver", "officer"].includes(role))
      return res.status(403).json({ error: "권한이 없습니다." });

    const leave = await Leave.findById(req.params.id);
    if (!leave)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });

    if (["CANCEL_REQ_REVIEW", "CANCEL_REQ_APPROVAL"].includes(leave.status)) {
      leave.status = "APPROVED";
      await leave.save();
      return res.json({
        success: true,
        message: "취소 신청이 반려되어 기존 휴가가 유지됩니다.",
      });
    }

    leave.status =
      role === "reviewer" || role === "officer"
        ? "REJECTED_REVIEW"
        : "REJECTED_APPROVAL";
    for (const us of leave.usedSlots) {
      const slot = await LeaveSlot.findById(us.slotId);
      if (slot) {
        slot.remains += us.qty;
        await slot.save();
      }
    }
    await leave.save();

    await recalculateWaitlist(req.user.orgId, leave.startDate, leave.endDate);

    res.json({
      success: true,
      message: "거절 처리 및 휴가 일수가 반환되었습니다.",
    });
  } catch (error) {
    res.status(500).json({ error: "거절 처리 실패" });
  }
});

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

router.put("/leaves/:id/review", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "reviewer" && req.user.role !== "officer")
      return res.status(403).json({ error: "권한이 없습니다." });

    const leave = await Leave.findById(req.params.id);
    if (!leave)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });

    if (leave.status === "PENDING_REVIEW") {
      leave.status = "PENDING_APPROVAL";
    } else if (leave.status === "CANCEL_REQ_REVIEW") {
      leave.status = "CANCEL_REQ_APPROVAL";
    }

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

router.put("/leaves/:id/approve", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "approver")
      return res.status(403).json({ error: "권한이 없습니다." });
    const leave = await Leave.findById(req.params.id);
    if (!leave)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });

    if (leave.status === "PENDING_APPROVAL") {
      leave.status = "APPROVED";
    } else if (leave.status === "CANCEL_REQ_APPROVAL") {
      leave.status = "CANCEL_APPROVED";
      for (const us of leave.usedSlots) {
        const slot = await LeaveSlot.findById(us.slotId);
        if (slot) {
          slot.remains += us.qty;
          await slot.save();
        }
      }
      await recalculateWaitlist(req.user.orgId, leave.startDate, leave.endDate);
    }

    leave.approverId = req.user.userId;
    leave.approvedAt = new Date();
    await leave.save();
    res.json({
      success: true,
      message: "최종 결재 완료. 달력에 즉시 반영됩니다.",
    });
  } catch (error) {
    res.status(500).json({ error: "승인 처리 실패" });
  }
});

router.put("/leaves/:id/force-cancel", authMiddleware, async (req, res) => {
  try {
    const { role } = req.user;
    const { cancelReason } = req.body;

    if (!["reviewer", "officer", "approver", "superadmin"].includes(role)) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    const leave = await Leave.findById(req.params.id);
    if (!leave)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });

    if (
      [
        "CANCELLED",
        "REJECTED_REVIEW",
        "REJECTED_APPROVAL",
        "FORCE_CANCELLED",
        "CANCEL_APPROVED",
      ].includes(leave.status)
    ) {
      return res
        .status(400)
        .json({ error: "이미 취소되거나 거절된 휴가입니다." });
    }

    if (["reviewer", "officer"].includes(role)) {
      if (leave.status !== "PENDING_APPROVAL") {
        return res.status(400).json({
          error:
            "검토자는 자신이 통과시킨 '승인 대기' 상태의 휴가만 취소할 수 있습니다.",
        });
      }
    } else if (["approver", "superadmin"].includes(role)) {
      if (leave.status !== "APPROVED") {
        return res.status(400).json({
          error:
            "최종 승인자는 '최종 승인'이 완료된 휴가만 취소할 수 있습니다.",
        });
      }
    }

    if (leave.usedSlots && Array.isArray(leave.usedSlots)) {
      for (const us of leave.usedSlots) {
        if (!us.slotId) continue;
        const slot = await LeaveSlot.findById(us.slotId);
        if (slot) {
          slot.remains += us.qty || 0;
          await slot.save();
        }
      }
    }

    leave.status = "FORCE_CANCELLED";
    leave.reason = `[직권취소] ${cancelReason || "사유 없음"} (기존 사유: ${
      leave.reason || "없음"
    })`;

    leave.updatedAt = new Date();
    await leave.save();

    if (leave.startDate && leave.endDate && req.user.orgId) {
      await recalculateWaitlist(req.user.orgId, leave.startDate, leave.endDate);
    }

    res.json({
      success: true,
      message: "휴가가 강제 취소되었으며 일수가 반환되었습니다.",
    });
  } catch (error) {
    console.error("🔥 Force Cancel Error 세부 정보:", error);
    res
      .status(500)
      .json({ error: "강제 취소 처리 중 서버 오류가 발생했습니다." });
  }
});

router.put("/leaves/:id/manual-override", authMiddleware, async (req, res) => {
  try {
    if (
      !["reviewer", "officer", "approver", "superadmin"].includes(req.user.role)
    ) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const leave = await Leave.findById(req.params.id);
    if (!leave)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });

    leave.isManualOverride = !leave.isManualOverride;
    if (leave.isManualOverride) leave.isWaitlisted = false;

    await leave.save();

    await recalculateWaitlist(req.user.orgId, leave.startDate, leave.endDate);

    res.json({ success: true, isManualOverride: leave.isManualOverride });
  } catch (error) {
    res.status(500).json({ error: "수동 개입 처리 중 오류 발생" });
  }
});

router.get("/leaves/rates", authMiddleware, async (req, res) => {
  try {
    const org = await Organization.findById(req.user.orgId);
    res.json({
      success: true,
      leaveRateLong: org?.settings?.leaveRateLong || 20,
      leaveRateShort: org?.settings?.leaveRateShort || 15,
      specialRates: org?.settings?.specialRates || [],
    });
  } catch (error) {
    res.status(500).json({ error: "설정 조회 실패" });
  }
});

router.put("/leaves/rates", authMiddleware, async (req, res) => {
  try {
    const { orgId, role } = req.user;
    const {
      leaveRateLong,
      leaveRateShort,
      specialStartDate,
      specialEndDate,
      specialReason,
      specialRateLong,
      specialRateShort,
    } = req.body;

    if (!["reviewer", "officer", "approver", "superadmin"].includes(role)) {
      return res.status(403).json({ error: "설정 변경 권한이 없습니다." });
    }

    const org = await Organization.findById(orgId);
    if (!org)
      return res.status(404).json({ error: "부대 정보를 찾을 수 없습니다." });
    if (!org.settings) org.settings = {};

    let isSpecial = false;

    if (specialStartDate && specialEndDate) {
      if (!org.settings.specialRates) org.settings.specialRates = [];
      org.settings.specialRates.push({
        startDate: specialStartDate,
        endDate: specialEndDate,
        rateLong: Number(specialRateLong) || 20,
        rateShort: Number(specialRateShort) || 15,
        reason: specialReason || "특별 기간",
      });
      isSpecial = true;
    } else {
      if (leaveRateLong !== undefined)
        org.settings.leaveRateLong = Number(leaveRateLong);
      if (leaveRateShort !== undefined)
        org.settings.leaveRateShort = Number(leaveRateShort);
    }

    await org.save();

    const activeLeaves = await Leave.find({
      organizationId: orgId,
      status: {
        $nin: [
          "CANCELLED",
          "REJECTED_REVIEW",
          "REJECTED_APPROVAL",
          "FORCE_CANCELLED",
        ],
      },
    });

    if (activeLeaves.length > 0) {
      const minDate = new Date(
        Math.min(...activeLeaves.map((l) => new Date(l.startDate)))
      );
      const maxDate = new Date(
        Math.max(...activeLeaves.map((l) => new Date(l.endDate)))
      );
      await recalculateWaitlist(orgId, minDate, maxDate);
    }

    res.json({
      success: true,
      message: isSpecial
        ? "특별 출타율이 추가되었습니다!"
        : "기본 출타율이 업데이트되었습니다!",
    });
  } catch (error) {
    res.status(500).json({ error: "업데이트 중 오류 발생" });
  }
});

router.delete(
  "/leaves/rates/special/:rateId",
  authMiddleware,
  async (req, res) => {
    try {
      const { orgId, role } = req.user;
      if (!["reviewer", "officer", "approver", "superadmin"].includes(role)) {
        return res.status(403).json({ error: "권한이 없습니다." });
      }

      const org = await Organization.findById(orgId);
      if (!org || !org.settings || !org.settings.specialRates) {
        return res.status(404).json({ error: "부대 설정을 찾을 수 없습니다." });
      }

      org.settings.specialRates = org.settings.specialRates.filter(
        (r) => r._id.toString() !== req.params.rateId
      );
      await org.save();

      const activeLeaves = await Leave.find({
        organizationId: orgId,
        status: {
          $nin: [
            "CANCELLED",
            "REJECTED_REVIEW",
            "REJECTED_APPROVAL",
            "FORCE_CANCELLED",
          ],
        },
      });

      if (activeLeaves.length > 0) {
        const minDate = new Date(
          Math.min(...activeLeaves.map((l) => new Date(l.startDate)))
        );
        const maxDate = new Date(
          Math.max(...activeLeaves.map((l) => new Date(l.endDate)))
        );
        await recalculateWaitlist(orgId, minDate, maxDate);
      }

      res.json({
        success: true,
        message: "특별 출타율 설정이 삭제되었습니다.",
      });
    } catch (error) {
      res.status(500).json({ error: "삭제 중 오류 발생" });
    }
  }
);

router.post(
  "/leaves/approve-calendar-phase1",
  authMiddleware,
  async (req, res) => {
    try {
      const { orgId, role } = req.user;
      const { year, month, mode } = req.body;

      if (!["reviewer", "officer", "approver", "superadmin"].includes(role)) {
        return res.status(403).json({ error: "일괄 결재 권한이 없습니다." });
      }

      let targetStatus = "PENDING_REVIEW";
      let newStatus = "PENDING_APPROVAL";
      let isApprover = false;

      if (role === "approver" || role === "superadmin") {
        targetStatus = "PENDING_APPROVAL";
        newStatus = "APPROVED";
        isApprover = true;
      }

      const query = { organizationId: orgId, status: targetStatus };

      if (year && month) {
        const startDateOfMonth = new Date(year, month - 1, 1);
        const endDateOfMonth = new Date(year, month, 0, 23, 59, 59);
        query.startDate = { $lte: endDateOfMonth };
        query.endDate = { $gte: startDateOfMonth };
      }

      if (mode === "team-long") {
        query.type = { $not: /외출|외박/ };
      } else if (mode === "team-short") {
        query.type = /외출|외박/;
      }

      if (!isApprover) query.isWaitlisted = false;

      const totalPending = await Leave.countDocuments(query);

      const updatePayload = { status: newStatus };
      if (isApprover) {
        updatePayload.approverId = req.user.userId;
        updatePayload.approvedAt = new Date();
      } else {
        updatePayload.reviewerId = req.user.userId;
        updatePayload.reviewedAt = new Date();
      }

      const leaveUpdate = await Leave.updateMany(query, {
        $set: updatePayload,
      });

      if (isApprover && leaveUpdate.modifiedCount > 0) {
        const approvedLeaves = await Leave.find({
          organizationId: orgId,
          status: "APPROVED",
          approverId: req.user.userId,
          approvedAt: { $gte: new Date(Date.now() - 5000) },
        });
        if (approvedLeaves.length > 0) {
          const minDate = new Date(
            Math.min(...approvedLeaves.map((l) => new Date(l.startDate)))
          );
          const maxDate = new Date(
            Math.max(...approvedLeaves.map((l) => new Date(l.endDate)))
          );
          await recalculateWaitlist(orgId, minDate, maxDate);
        }
      }

      const skippedCount = totalPending - leaveUpdate.modifiedCount;
      const roleName = isApprover ? "최종 승인" : "검토 완료";

      if (leaveUpdate.modifiedCount === 0) {
        return res.json({
          success: true,
          message: "해당 월/분류에 처리할 대기 건이 없습니다.",
          skippedCount,
          isApprover,
        });
      }

      res.json({
        success: true,
        message: `해당 월의 총 ${leaveUpdate.modifiedCount}건이 일괄 ${roleName} 되었습니다.`,
        skippedCount,
        isApprover,
      });
    } catch (error) {
      res
        .status(500)
        .json({ error: "일괄 결재 처리 중 서버 오류가 발생했습니다." });
    }
  }
);

router.post(
  "/leaves/reject-calendar-waitlist",
  authMiddleware,
  async (req, res) => {
    try {
      const { orgId, role } = req.user;
      const { year, month, mode } = req.body;

      if (!["reviewer", "officer", "approver", "superadmin"].includes(role)) {
        return res.status(403).json({ error: "권한이 없습니다." });
      }

      const query = {
        organizationId: orgId,
        status: "PENDING_REVIEW",
        isWaitlisted: true,
      };

      if (year && month) {
        const startDateOfMonth = new Date(year, month - 1, 1);
        const endDateOfMonth = new Date(year, month, 0, 23, 59, 59);
        query.startDate = { $lte: endDateOfMonth };
        query.endDate = { $gte: startDateOfMonth };
      }

      if (mode === "team-long") {
        query.type = { $not: /외출|외박/ };
      } else if (mode === "team-short") {
        query.type = /외출|외박/;
      }

      const leavesToReject = await Leave.find(query);
      let rejectedCount = 0;

      for (const leave of leavesToReject) {
        for (const us of leave.usedSlots) {
          const slot = await LeaveSlot.findById(us.slotId);
          if (slot) {
            slot.remains += us.qty;
            await slot.save();
          }
        }
        leave.status = "REJECTED_REVIEW";
        await leave.save();
        rejectedCount++;
      }

      res.json({
        success: true,
        message: `총 ${rejectedCount}건의 후보 휴가가 일괄 반려 처리되고, 일수가 반환되었습니다.`,
      });
    } catch (error) {
      console.error("🔥 Reject Waitlist Error:", error);
      res
        .status(500)
        .json({ error: "일괄 반려 처리 중 서버 오류가 발생했습니다." });
    }
  }
);

router.post("/leaves/approve-all", authMiddleware, async (req, res) => {
  try {
    const { orgId, role } = req.user;

    if (!["reviewer", "approver", "superadmin", "officer"].includes(role)) {
      return res.status(403).json({ error: "일괄 승인 권한이 없습니다." });
    }

    let targetStatus = "";
    let newStatus = "";

    if (role === "reviewer" || role === "officer") {
      targetStatus = "PENDING_REVIEW";
      newStatus = "PENDING_APPROVAL";
    } else if (role === "approver" || role === "superadmin") {
      targetStatus = "PENDING_APPROVAL";
      newStatus = "APPROVED";
    }

    const totalPendingLeaves = await Leave.countDocuments({
      organizationId: orgId,
      status: {
        $in: [targetStatus, targetStatus.replace("PENDING", "CANCEL_REQ")],
      },
    });

    const leaveUpdate = await Leave.updateMany(
      { organizationId: orgId, status: targetStatus, isWaitlisted: false },
      {
        $set: {
          status: newStatus,
          [role === "approver" ? "approverId" : "reviewerId"]: req.user.userId,
          [role === "approver" ? "approvedAt" : "reviewedAt"]: new Date(),
        },
      }
    );

    if (role === "approver" || role === "superadmin") {
      const approvedLeaves = await Leave.find({
        organizationId: orgId,
        status: "APPROVED",
        approverId: req.user.userId,
        approvedAt: { $gte: new Date(Date.now() - 5000) },
      });

      if (approvedLeaves.length > 0) {
        const minDate = new Date(
          Math.min(...approvedLeaves.map((l) => new Date(l.startDate)))
        );
        const maxDate = new Date(
          Math.max(...approvedLeaves.map((l) => new Date(l.endDate)))
        );
        await recalculateWaitlist(orgId, minDate, maxDate);
      }
    }

    const skippedCount = totalPendingLeaves - leaveUpdate.modifiedCount;

    if (leaveUpdate.modifiedCount === 0) {
      return res.json({
        success: true,
        message: "일괄 승인 가능한 안전한 휴가(정규 편성)가 없습니다.",
        skippedCount: skippedCount,
      });
    }

    res.json({
      success: true,
      message: `총 ${leaveUpdate.modifiedCount}건의 일반 휴가가 일괄 승인되었습니다.`,
      skippedCount: skippedCount,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "일괄 승인 처리 중 서버 오류가 발생했습니다." });
  }
});

router.get("/leaves/user-history/:userId", authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { beforeDate } = req.query;

    if (!beforeDate) {
      return res
        .status(400)
        .json({ error: "기준 날짜가 필요합니다. (beforeDate)" });
    }

    const targetDate = new Date(beforeDate);

    const pastLeaves = await Leave.find({
      userId: userId,
      status: {
        $in: [
          "APPROVED",
          "CANCEL_REQ_REVIEW",
          "CANCEL_REQ_APPROVAL",
          "CANCEL_APPROVED",
        ],
      },
      startDate: { $lt: targetDate },
    })
      .sort({ startDate: -1 })
      .lean();

    const history = {
      휴가: [],
      외박: [],
      외출: [],
    };

    const today = new Date();

    pastLeaves.forEach((leave) => {
      const type = leave.type || "휴가";

      if (history[type] && history[type].length < 3) {
        const endDate = new Date(leave.endDate);
        const daysAgo = Math.floor((today - endDate) / (1000 * 60 * 60 * 24));

        history[type].push({
          startDate: leave.startDate,
          endDate: leave.endDate,
          reason: leave.reason,
          daysAgo: daysAgo > 0 ? daysAgo : 0,
        });
      }
    });

    res.json({ success: true, history });
  } catch (error) {
    console.error("🔥 역사 기록 조회 오류:", error);
    res.status(500).json({ error: "기록 조회 중 서버 오류가 발생했습니다." });
  }
});

router.put("/leaves/swap-priority", authMiddleware, async (req, res) => {
  try {
    if (
      !["reviewer", "officer", "approver", "superadmin"].includes(req.user.role)
    ) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    const { leaveId1, leaveId2 } = req.body;
    if (!leaveId1 || !leaveId2)
      return res.status(400).json({ error: "잘못된 요청입니다." });

    const leave1 = await Leave.findById(leaveId1);
    const leave2 = await Leave.findById(leaveId2);

    if (!leave1 || !leave2)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });
    if (
      leave1.organizationId.toString() !== req.user.orgId ||
      leave2.organizationId.toString() !== req.user.orgId
    ) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    if (leave1.status === "APPROVED" || leave2.status === "APPROVED") {
      return res
        .status(400)
        .json({ error: "이미 최종 승인된 휴가는 맞바꿀 수 없습니다." });
    }

    const tempScore = leave1.priorityScore;
    leave1.priorityScore = leave2.priorityScore;
    leave2.priorityScore = tempScore;

    leave1.isManualOverride = false;
    leave2.isManualOverride = false;

    await leave1.save();
    await leave2.save();

    const minDate = new Date(
      Math.min(new Date(leave1.startDate), new Date(leave2.startDate))
    );
    const maxDate = new Date(
      Math.max(new Date(leave1.endDate), new Date(leave2.endDate))
    );
    await recalculateWaitlist(req.user.orgId, minDate, maxDate);

    res.json({
      success: true,
      message: "두 인원의 휴가 순위가 성공적으로 맞바뀌었습니다.",
    });
  } catch (error) {
    res.status(500).json({ error: "순위 교환 중 서버 오류가 발생했습니다." });
  }
});

router.get("/leaves/detail/:id", authMiddleware, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id)
      .populate(
        "userId",
        "name rank serviceNumber role promoToIlbyung promoToSangbyung promoToByungjang"
      )
      .populate("usedSlots.slotId", "type reason")
      .lean();

    if (!leave)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });

    res.json({ success: true, leave });
  } catch (error) {
    res.status(500).json({ error: "상세 조회 실패" });
  }
});

module.exports = router;
