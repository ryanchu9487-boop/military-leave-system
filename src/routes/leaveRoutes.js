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

// 📁 Multer 檔案上傳設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 🔥 改成退兩層，準確存入專案的 public/uploads 裡面 ✅
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

// ==========================================
// 🔥 1. 幹部發放額度 (已拔除檔案功能，恢復純文字)
// ==========================================
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

// ==========================================
// 🔥 2. 勇士申請假單 (新增：支援多檔案上傳)
// ==========================================
router.post("/leaves", authMiddleware, upload.array("evidenceFiles", 5), async (req, res) => {
  try {
    const { startDate, endDate, destination, emergencyContact, reason } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // 前端 FormData 傳來的 usedSlots 是字串，必須轉回 JSON 陣列
    let usedSlots = [];
    if (req.body.usedSlots) {
        usedSlots = typeof req.body.usedSlots === 'string' ? JSON.parse(req.body.usedSlots) : req.body.usedSlots;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const overlapping = await Leave.findOne({
      userId,
      status: { $nin: ["CANCELLED", "REJECTED_REVIEW", "REJECTED_APPROVAL"] },
      $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }],
    });

    if (overlapping)
      return res.status(400).json({ error: "해당 기간에 이미 신청된 휴가가 있습니다." });

    const daysUsed = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    if (!usedSlots || usedSlots.length === 0)
      return res.status(400).json({ error: "사용할 휴가가 할당되지 않았습니다." });

    const totalSlotQty = usedSlots.reduce((sum, slot) => sum + slot.qty, 0);
    if (totalSlotQty !== daysUsed)
      return res.status(400).json({ error: "신청 일수와 할당된 휴가 일수가 일치하지 않습니다." });

    let mainType = "휴가";
    for (const us of usedSlots) {
      const slot = await LeaveSlot.findById(us.slotId);
      if (!slot || slot.userId.toString() !== userId || slot.remains < us.qty) {
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

    // 📁 處理勇士上傳的檔案路徑
    let evidenceFilesPaths = [];
    if (req.files && req.files.length > 0) {
      evidenceFilesPaths = req.files.map(file => `/uploads/${file.filename}`);
    }

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
      evidenceFiles: evidenceFilesPaths, // 把檔案路徑存進這張假單
    });

    await newLeave.save();
    res.json({
      success: true,
      message: "성공적으로 출타 신청이 완료되었습니다.",
      leave: newLeave,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "출타 신청 중 오류가 발생했습니다." });
  }
});

router.get("/leaves/my", authMiddleware, async (req, res) => {
  try {
    const leaves = await Leave.find({
      userId: req.user.userId,
      status: { $ne: "CANCELLED" },
    })
      .populate("userId", "name rank serviceNumber")
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
      query.status = { $in: ["APPROVED", "CANCEL_REQ_REVIEW", "CANCEL_REQ_APPROVAL", "CANCEL_APPROVED"] };
    } else {
      query.status = { $nin: ["CANCELLED", "REJECTED_REVIEW", "REJECTED_APPROVAL"] };
    }

    const leaves = await Leave.find(query)
      .populate("userId", "name rank serviceNumber")
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
    }));
    
    res.json({ leaves: mappedLeaves });
  } catch (error) {
    res.status(500).json({ error: "전체 휴가 조회 실패" });
  }
});

// ==========================================
// 🔥 3. 小鈴鐺通知 (已補上 rank 和 serviceNumber)
// ==========================================
router.get("/notifications", authMiddleware, async (req, res) => {
  try {
    const { userId, orgId, role } = req.user;
    const currentUser = await User.findById(userId).populate("organizationId");

    let notifications = [];

    // 🔥 這裡的 populate 已經全面升級為抓取 "name rank serviceNumber"
    if (role === "reviewer" || role === "officer") {
      const leaves = await Leave.find({
        organizationId: orgId,
        status: { $in: ["PENDING_REVIEW", "CANCEL_REQ_REVIEW"] },
      })
        .populate("userId", "name rank serviceNumber")
        .lean();
      notifications.push(...leaves);
    } else if (role === "approver" || role === "superadmin") {
      const leaves = await Leave.find({
        organizationId: orgId,
        status: { $in: ["PENDING_APPROVAL", "CANCEL_REQ_APPROVAL"] },
      })
        .populate("userId", "name rank serviceNumber")
        .lean();
      notifications.push(...leaves);
    } else if (role === "soldier") {
      const leaves = await Leave.find({
        userId: userId,
        status: { $in: ["REJECTED_REVIEW", "REJECTED_APPROVAL"] },
      })
        .populate("userId", "name rank serviceNumber")
        .lean();
      notifications.push(...leaves);
    }

    if (["reviewer", "approver", "admin", "superadmin", "officer"].includes(role)) {
      const pendingUsers = await User.find({
        organizationId: orgId,
        status: "pending",
      }).lean();
      pendingUsers.forEach((pu) => {
        notifications.push({
          _id: pu._id,
          status: "NEW_MEMBER_PENDING",
          reason: "신규 부대원 가입 승인 대기",
          userId: { name: pu.name },
          createdAt: pu.createdAt,
        });
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const dischargingUsers = await User.find({
        organizationId: orgId,
        status: "approved",
        dischargeDate: { $gte: today, $lt: tomorrow },
      }).lean();

      dischargingUsers.forEach((du) => {
        notifications.push({
          _id: du._id,
          status: "DISCHARGE_TODAY",
          reason: "오늘 전역 예정입니다. 전역 처리를 진행해주세요.",
          userId: { name: du.name },
          createdAt: new Date(),
        });
      });

      const resetUsers = await User.find({
        organizationId: orgId,
        resetRequested: true,
      }).lean();

      resetUsers.forEach((ru) => {
        notifications.push({
          _id: ru._id, 
          status: "PASSWORD_RESET_REQ",
          reason: "비밀번호 초기화 요청", 
          userId: { name: ru.name },
          createdAt: ru.updatedAt || new Date(), 
        });
      });
    }

    notifications.sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

    res.json({
      success: true,
      userInfo: {
        name: currentUser.name,
        role: currentUser.role,
        unitName: currentUser.organizationId?.name,
      },
      notifications,
    });
  } catch (error) {
    res.status(500).json({ error: "알림 정보를 불러오는데 실패했습니다." });
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
      (role === "reviewer" || role === "officer") ? "REJECTED_REVIEW" : "REJECTED_APPROVAL";
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

router.delete("/leaves/:id", authMiddleware, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    if (!leave)
      return res.status(404).json({ error: "휴가를 찾을 수 없습니다." });
    if (leave.userId.toString() !== req.user.userId)
      return res.status(403).json({ error: "권한이 없습니다." });

    if (["PENDING_REVIEW", "PENDING_APPROVAL"].includes(leave.status)) {
      for (const us of leave.usedSlots) {
        const slot = await LeaveSlot.findById(us.slotId);
        if (slot) {
          slot.remains += us.qty;
          await slot.save();
        }
      }
      leave.status = "CANCELLED";
      await leave.save();
      return res.json({
        success: true,
        message: "휴가가 즉시 취소되었습니다. (일수 반환 완료)",
      });
    } else if (leave.status === "APPROVED") {
      let initialCancelStatus = "CANCEL_REQ_REVIEW";
      if (req.user.role === "officer" || req.user.role === "reviewer")
        initialCancelStatus = "CANCEL_REQ_APPROVAL";
      leave.status = initialCancelStatus;
      await leave.save();
      return res.json({
        success: true,
        message: "승인된 휴가입니다. 취소 결재가 상신되었습니다.",
      });
    } else {
      return res.status(400).json({ error: "취소할 수 없는 상태입니다." });
    }
  } catch (error) {
    res.status(500).json({ error: "취소 처리 실패" });
  }
});

router.post("/leaves/approve-all", authMiddleware, async (req, res) => {
  try {
      const { orgId, role } = req.user;
      
      if (!["reviewer", "approver", "superadmin", "officer"].includes(role)) {
          return res.status(403).json({ error: "일괄 승인 권한이 없습니다." });
      }

      let targetStatus = "";
      let newStatus = "";
      let targetCancelStatus = "";
      let newCancelStatus = "";

      if (role === "reviewer" || role === "officer") {
          targetStatus = "PENDING_REVIEW";
          newStatus = "PENDING_APPROVAL"; 
          targetCancelStatus = "CANCEL_REQ_REVIEW";
          newCancelStatus = "CANCEL_REQ_APPROVAL";
      } else if (role === "approver" || role === "superadmin") {
          targetStatus = "PENDING_APPROVAL";
          newStatus = "APPROVED"; 
          targetCancelStatus = "CANCEL_REQ_APPROVAL";
          newCancelStatus = "CANCEL_APPROVED";
      }

      const leaveUpdate = await Leave.updateMany(
          { organizationId: orgId, status: targetStatus },
          { $set: { status: newStatus } }
      );

      const cancelUpdate = await Leave.updateMany(
          { organizationId: orgId, status: targetCancelStatus },
          { $set: { status: newCancelStatus } }
      );

      const totalUpdated = leaveUpdate.modifiedCount + cancelUpdate.modifiedCount;

      if (totalUpdated === 0) {
          return res.json({ success: true, message: "승인할 대기 건이 없습니다." });
      }

      res.json({ 
          success: true, 
          message: `총 ${totalUpdated}건의 휴가 및 취소 요청이 일괄 승인되었습니다.` 
      });

  } catch (error) {
      res.status(500).json({ error: "일괄 승인 처리 중 서버 오류가 발생했습니다." });
  }
});

// 🔥 시간 절단(Time-slice) 이력 조회 API
router.get("/leaves/user-history/:userId", authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { beforeDate } = req.query;

    if (!beforeDate) {
      return res.status(400).json({ error: "기준 날짜가 필요합니다. (beforeDate)" });
    }

    const targetDate = new Date(beforeDate);

    const pastLeaves = await Leave.find({
      userId: userId,
      status: { $in: ["APPROVED", "CANCEL_REQ_REVIEW", "CANCEL_REQ_APPROVAL", "CANCEL_APPROVED"] },
      startDate: { $lt: targetDate } 
    })
      .sort({ startDate: -1 }) 
      .lean();

    const history = {
      "휴가": [],
      "외박": [],
      "외출": []
    };

    const today = new Date();

    pastLeaves.forEach(leave => {
      const type = leave.type || "휴가"; 
      
      if (history[type] && history[type].length < 3) {
        const endDate = new Date(leave.endDate);
        const daysAgo = Math.floor((today - endDate) / (1000 * 60 * 60 * 24));
        
        history[type].push({
          startDate: leave.startDate,
          endDate: leave.endDate,
          reason: leave.reason,
          daysAgo: daysAgo > 0 ? daysAgo : 0 
        });
      }
    });

    res.json({ success: true, history });

  } catch (error) {
    console.error("🔥 역사 기록 조회 오류:", error);
    res.status(500).json({ error: "기록 조회 중 서버 오류가 발생했습니다." });
  }
});

module.exports = router;