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
// 🧠 [核心大腦 1] 優先順位計分器 (Priority Score Calculator)
// ==========================================
async function calculatePriorityScore(user, leaveType, leaveReason, startDate) {
  let score = 0;
  const now = new Date();
  const targetDate = new Date(startDate);

  // 1. 判斷是否錯過申請死線 (Phase 1 vs Phase 2)
  const deadline = new Date(targetDate.getFullYear(), targetDate.getMonth() - 1, 1);
  if (now > deadline) {
    // 遲交者 (Phase 2)：直接扣 10萬分，永遠墊底，只能撿漏
    score -= 100000;
  }

  // 2. 長假 (휴가) 專屬加分
  if (leaveType === "휴가") {
    // 第 1 順位：新兵慰勞休假 (無敵星星)
    if (leaveReason.includes("신병위로휴가")) score += 50000;
    
    // 第 2 順位：退伍前兩個月的末年休假 (말년휴가)
    if (user.dischargeDate) {
      const daysToDischarge = (new Date(user.dischargeDate) - targetDate) / (1000 * 60 * 60 * 24);
      if (daysToDischarge <= 60 && daysToDischarge > 0) score += 30000;
    }
  }

  // 3. 短假 (외출/외박) 專屬加分
  if (leaveType === "외출" || leaveType === "외박") {
    if (leaveReason.includes("정기")) score += 10000; // 定期優先於特別
  }

  // 4. 距離上次休假越久，分數越高 (每天 +10 分)
  const lastLeave = await Leave.findOne({
    userId: user._id,
    type: "휴가",
    status: { $in: ["APPROVED", "PENDING_APPROVAL", "PENDING_REVIEW"] }
  }).sort({ endDate: -1 });

  if (lastLeave) {
    const daysSinceLastLeave = Math.max(0, (now - new Date(lastLeave.endDate)) / (1000 * 60 * 60 * 24));
    score += Math.floor(daysSinceLastLeave * 10);
  } else {
    // 從來沒放過假的人，給予極高補償分
    score += 5000;
  }

  // 5. 終極平手判定 (Tie-breaker)
  // 5-1. 入伍日越早越好 (老兵優待)
  if (user.enlistmentDate) {
    const daysServed = Math.max(0, (now - new Date(user.enlistmentDate)) / (1000 * 60 * 60 * 24));
    score += Math.floor(daysServed);
  }
  
  // 5-2. 總出島次數越少越好 (扣分機制)
  const totalLeavesTaken = await Leave.countDocuments({
    userId: user._id,
    status: { $in: ["APPROVED", "PENDING_APPROVAL", "PENDING_REVIEW"] }
  });
  score -= (totalLeavesTaken * 50);

  return score;
}

// ==========================================
// 🧠 [核心大腦 2] 全自動連帶判定引擎 (All-or-Nothing Waitlist Recalculator)
// ==========================================
async function recalculateWaitlist(orgId, startDate, endDate) {
  const org = await Organization.findById(orgId);
  if (!org) return;

  const totalSoldiers = org.settings?.totalSoldiers || 100;
  const limitLong = Math.floor(totalSoldiers * ((org.settings?.leaveRateLong || 20) / 100));
  const limitShort = Math.floor(totalSoldiers * ((org.settings?.leaveRateShort || 15) / 100));

  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // 找出這段期間內所有重疊的假單
  const overlappingLeaves = await Leave.find({
    organizationId: orgId,
    status: { $nin: ["CANCELLED", "REJECTED_REVIEW", "REJECTED_APPROVAL"] },
    $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }],
  }).populate("userId", "role");

  // 只過濾出勇士 (幹部不佔名額)
  const soldierLeaves = overlappingLeaves.filter(l => l.userId && l.userId.role === "soldier");

  // 建立一個字典來記錄每張假單是否「觸雷」
  let waitlistFlags = {};
  soldierLeaves.forEach(l => waitlistFlags[l._id.toString()] = false);

  // 逐日檢查
  let iter = new Date(start);
  while (iter <= end) {
    const currentDayLeaves = soldierLeaves.filter(l => new Date(l.startDate) <= iter && new Date(l.endDate) >= iter);
    
    // 分成長假與短假
    const longLeaves = currentDayLeaves.filter(l => l.type === "휴가");
    const shortLeaves = currentDayLeaves.filter(l => l.type === "외출" || l.type === "외박");

    // 排序邏輯：1. 手動鎖定(長官保底)優先 2. 積分高優先
    const sortFn = (a, b) => {
      if (a.isManualOverride && !b.isManualOverride) return -1;
      if (!a.isManualOverride && b.isManualOverride) return 1;
      return b.priorityScore - a.priorityScore;
    };

    longLeaves.sort(sortFn);
    shortLeaves.sort(sortFn);

    // 如果名次超過了當日的極限人數，標記觸雷
    longLeaves.forEach((l, index) => {
      if (index >= limitLong) waitlistFlags[l._id.toString()] = true;
    });
    shortLeaves.forEach((l, index) => {
      if (index >= limitShort) waitlistFlags[l._id.toString()] = true;
    });

    iter.setDate(iter.getDate() + 1);
  }

  // 只要有任何一天觸雷 (All-or-Nothing)，整張假單更新為候補 (isWaitlisted = true)
  for (const leave of soldierLeaves) {
    const shouldBeWaitlisted = waitlistFlags[leave._id.toString()];
    if (leave.isWaitlisted !== shouldBeWaitlisted && !leave.isManualOverride) {
      leave.isWaitlisted = shouldBeWaitlisted;
      await leave.save();
    }
  }
}

// ==========================================
// 1. 幹部發放/勇士登錄 額度
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
// 🔥 2. 勇士申請假單
// ==========================================
router.post("/leaves", authMiddleware, upload.array("evidenceFiles", 5), async (req, res) => {
  try {
    const { startDate, endDate, destination, emergencyContact, reason } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

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

    let evidenceFilesPaths = [];
    if (req.files && req.files.length > 0) {
      evidenceFilesPaths = req.files.map(file => `/uploads/${file.filename}`);
    }

    const currentUser = await User.findById(userId);
    const calculatedScore = await calculatePriorityScore(currentUser, mainType, reason, startDate);

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
      isWaitlisted: false 
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
});

router.get("/leaves/my", authMiddleware, async (req, res) => {
  try {
    const leaves = await Leave.find({
      userId: req.user.userId,
      status: { $ne: "CANCELLED" },
    })
      .populate("userId", "name rank serviceNumber role promoToIlbyung promoToSangbyung promoToByungjang")
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
      isWaitlisted: l.isWaitlisted
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
      .populate("userId", "name rank serviceNumber role promoToIlbyung promoToSangbyung promoToByungjang")
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
      priorityScore: l.priorityScore
    }));
    
    res.json({ leaves: mappedLeaves });
  } catch (error) {
    res.status(500).json({ error: "전체 휴가 조회 실패" });
  }
});

// ==========================================
// 3. 小鈴鐺通知
// ==========================================
router.get("/notifications", authMiddleware, async (req, res) => {
  try {
    const { userId, orgId, role } = req.user;
    const currentUser = await User.findById(userId).populate("organizationId");

    let notifications = [];

    if (role === "reviewer" || role === "officer") {
      const leaves = await Leave.find({
        organizationId: orgId,
        status: { $in: ["PENDING_REVIEW", "CANCEL_REQ_REVIEW"] },
      })
        .populate("userId", "name rank serviceNumber role promoToIlbyung promoToSangbyung promoToByungjang")
        .lean();
      notifications.push(...leaves);
    } else if (role === "approver" || role === "superadmin") {
      const leaves = await Leave.find({
        organizationId: orgId,
        status: { $in: ["PENDING_APPROVAL", "CANCEL_REQ_APPROVAL"] },
      })
        .populate("userId", "name rank serviceNumber role promoToIlbyung promoToSangbyung promoToByungjang")
        .lean();
      notifications.push(...leaves);
    } else if (role === "soldier") {
      const leaves = await Leave.find({
        userId: userId,
        status: { $in: ["REJECTED_REVIEW", "REJECTED_APPROVAL"] },
      })
        .populate("userId", "name rank serviceNumber role promoToIlbyung promoToSangbyung promoToByungjang")
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
      
      await recalculateWaitlist(req.user.orgId, leave.startDate, leave.endDate);
      
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


// ==========================================
// 🔥 [新增] 月曆專屬：一鍵結算 (只處理正取，由檢討者發動)
// ==========================================
router.post("/leaves/approve-calendar-phase1", authMiddleware, async (req, res) => {
  try {
      const { orgId, role } = req.user;
      
      if (!["reviewer", "officer", "superadmin"].includes(role)) {
          return res.status(403).json({ error: "일괄 검토 권한이 없습니다." });
      }

      // 1. 只針對 "PENDING_REVIEW" 且 "isWaitlisted: false" (正取) 的假單進行升級
      const leaveUpdate = await Leave.updateMany(
          { organizationId: orgId, status: "PENDING_REVIEW", isWaitlisted: false },
          { $set: { status: "PENDING_APPROVAL", reviewerId: req.user.userId, reviewedAt: new Date() } }
      );

      // 2. 順便處理「取消申請」，取消通常沒有名額問題，一併放行
      const cancelUpdate = await Leave.updateMany(
          { organizationId: orgId, status: "CANCEL_REQ_REVIEW" },
          { $set: { status: "CANCEL_REQ_APPROVAL", reviewerId: req.user.userId, reviewedAt: new Date() } }
      );

      const totalUpdated = leaveUpdate.modifiedCount + cancelUpdate.modifiedCount;

      if (totalUpdated === 0) {
          return res.json({ success: true, message: "승인할 정규 편성(정원 내) 대기 건이 없습니다." });
      }

      res.json({ 
          success: true, 
          message: `총 ${totalUpdated}건의 정규 편성 휴가 및 취소 요청이 검토 완료되었습니다.` 
      });

  } catch (error) {
      res.status(500).json({ error: "일괄 검토 처리 중 서버 오류가 발생했습니다." });
  }
});

// ==========================================
// 🔥 [修改] 小鈴鐺專屬：霸王條款一鍵結算 (無視備取，全數放行)
// ==========================================
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

      // 🔥 霸王條款：拿掉 isWaitlisted: false 的限制！只要是等待審核狀態，全數放行！
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
          message: `총 ${totalUpdated}건의 휴가 및 취소 요청이 일괄 처리되었습니다.` 
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