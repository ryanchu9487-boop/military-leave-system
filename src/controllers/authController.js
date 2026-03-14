const User = require("../../models/User");
const Organization = require("../../models/Organization");
const LeaveSlot = require("../../models/LeaveSlot");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

// 🔥 [升級版數學邏輯] 根據身分計算日期
function calculateMilitaryDates(
  enlistmentDateStr,
  customDischargeDateStr,
  role
) {
  if (!enlistmentDateStr) return {};
  const eDate = new Date(enlistmentDateStr);
  let dDate = null;

  // 1. 退伍日邏輯
  if (customDischargeDateStr) {
    // 幹部：使用自訂填寫的退伍日
    dDate = new Date(customDischargeDateStr);
  } else {
    // 勇士：強制入伍日 + 18個月 - 1天
    dDate = new Date(eDate);
    dDate.setMonth(dDate.getMonth() + 18);
    dDate.setDate(dDate.getDate() - 1);
  }

  // 如果是幹部(長官)，不需要計算二兵、一兵的晉升日，直接回傳即可
  if (role !== "soldier") {
    return { enlistmentDate: eDate, dischargeDate: dDate };
  }

  // 2. 勇士專屬：每月 1 號晉升邏輯
  const getPromoDate = (months) => {
    const pDate = new Date(eDate);
    pDate.setMonth(pDate.getMonth() + months);
    pDate.setDate(1); // 韓國軍隊鐵則：統一每月 1 號晉升
    return pDate;
  };

  return {
    enlistmentDate: eDate,
    dischargeDate: dDate,
    promoToIlbyung: getPromoDate(3), // 3個月後升一兵
    promoToSangbyung: getPromoDate(9), // 9個月後升上兵
    promoToByungjang: getPromoDate(15), // 15個月後升兵長
  };
}

async function refreshSoldierDefaultLeaves(user, orgId) {
  const now = new Date();
  const yearShort = now.getFullYear().toString().slice(-2);
  const month = now.getMonth() + 1;
  const quarter = Math.ceil(month / 3);

  const userId = user._id;
  const unitId = user.unitId || orgId;

  const hasAnnual = await LeaveSlot.findOne({
    userId,
    type: "휴가",
    reason: "연가",
  });
  if (!hasAnnual) {
    await LeaveSlot.create({
      organizationId: orgId,
      unitId,
      userId,
      type: "휴가",
      reason: "연가",
      totalCount: 24,
      remains: 24,
      status: "active",
    });
  }

  const quarterLabel = `${yearShort}년 ${quarter}분기 정기외박`;
  const existingQuarter = await LeaveSlot.findOne({
    userId,
    type: "외박",
    reason: quarterLabel,
  });
  if (!existingQuarter) {
    await LeaveSlot.deleteMany({ userId, type: "외박", reason: /정기외박/ });
    await LeaveSlot.create({
      organizationId: orgId,
      unitId,
      userId,
      type: "외박",
      reason: quarterLabel,
      totalCount: 1,
      remains: 1,
      status: "active",
    });
  }

  const weekdayLabel = `${yearShort}년 ${month}월 평일정기외출`;
  const weekendLabel = `${yearShort}년 ${month}월 주말정기외출`;
  const existingMonth = await LeaveSlot.findOne({
    userId,
    type: "외출",
    reason: weekdayLabel,
  });
  if (!existingMonth) {
    await LeaveSlot.deleteMany({ userId, type: "외출", reason: /정기외출/ });
    await LeaveSlot.create({
      organizationId: orgId,
      unitId,
      userId,
      type: "외출",
      reason: weekdayLabel,
      totalCount: 2,
      remains: 2,
      status: "active",
    });
    await LeaveSlot.create({
      organizationId: orgId,
      unitId,
      userId,
      type: "외출",
      reason: weekendLabel,
      totalCount: 1,
      remains: 1,
      status: "active",
    });
  }
}

exports.login = async (req, res) => {
  try {
    const { serviceNumber, password } = req.body;
    if (!serviceNumber || !password) {
      return res
        .status(400)
        .json({ success: false, message: "군번과 비밀번호를 입력하세요." });
    }

    const user = await User.findOne({ serviceNumber })
      .select("+password")
      .populate("organizationId", "name orgCode");
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "정보가 일치하지 않습니다." });
    }

    // 檢查帳號是否被鎖定
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const remainingTime = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(403).json({
        success: false,
        message: `계정이 잠겨 있습니다. ${remainingTime}분 후 다시 시도해주세요.`,
      });
    }

    // 檢查是否還在審核中
    if (user.status === "pending") {
      return res
        .status(403)
        .json({ success: false, message: "관리자 승인 대기 중입니다." });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    // 密碼錯誤防呆與警告機制
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      const maxAttempts = 5;
      const remains = maxAttempts - user.loginAttempts;

      if (user.loginAttempts >= maxAttempts) {
        user.lockUntil = Date.now() + 10 * 60 * 1000; // 鎖定 10 分鐘
        await user.save();
        return res.status(401).json({
          success: false,
          message:
            "비밀번호 5회 오류로 계정이 10분간 잠깁니다. 잠시 후 다시 시도해주세요.",
        });
      } else {
        await user.save();
        return res.status(401).json({
          success: false,
          message: `비밀번호가 일치하지 않습니다. (남은 기회: ${remains}회)`,
        });
      }
    }

    // 登入成功，重置錯誤次數
    if (user.role === "soldier")
      await refreshSoldierDefaultLeaves(user, user.organizationId?._id);

    user.loginAttempts = 0;
    user.lockUntil = null;
    user.lastLoginAt = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user._id, orgId: user.organizationId?._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    res.json({
      success: true,
      token,
      user: {
        name: user.name,
        role: user.role,
        orgName: user.organizationId?.name,
        // 🔥 關鍵：把「是否需要強制改密碼」的狀態傳給前端
        forceChangePassword: user.forceChangePassword || false,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "서버 내부 오류가 발생했습니다." });
  }
};

exports.registerOrganization = async (req, res) => {
  try {
    const {
      unitName,
      name,
      serviceNumber,
      phoneNumber,
      password,
      enlistmentDate,
      dischargeDate,
      isCadre,
    } = req.body;

    if (!unitName || !name || !serviceNumber || !phoneNumber || !password) {
      return res.status(400).json({ error: "모든 항목을 입력해 주세요." });
    }

    const existingUser = await User.findOne({ serviceNumber });
    if (existingUser)
      return res.status(400).json({ error: "이미 등록된 군번입니다." });

    const org = await Organization.findOne({ name: unitName });
    if (!org)
      return res
        .status(404)
        .json({ error: `'${unitName}'은(는) 등록되지 않은 부대입니다.` });

    const existingAdmin = await User.findOne({
      organizationId: org._id,
      role: { $in: ["approver", "admin", "superadmin"] },
    });

    let finalRole = "soldier";
    let finalRank = "용사";
    let finalStatus = "pending";

    if (existingAdmin) {
      finalStatus = "pending";
      if (isCadre) {
        finalRole = "reviewer";
        finalRank = "간부";
      } else {
        finalRole = "soldier";
      }
    } else {
      finalRole = "approver";
      finalRank = "최고승인자";
      finalStatus = "approved";
    }

    const militaryDates = calculateMilitaryDates(
      enlistmentDate,
      dischargeDate,
      finalRole
    );

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      organizationId: org._id,
      name: name,
      rank: finalRank,
      serviceNumber: serviceNumber,
      phoneNumber: phoneNumber,
      password: hashedPassword,
      role: finalRole,
      status: finalStatus,
      isActive: true,
      ...militaryDates,
    });

    if (finalStatus === "pending") {
      return res.json({
        message: `${org.name} 가입 신청이 완료되었습니다. 관리자 승인 후 로그인 가능합니다.`,
      });
    } else {
      return res.json({
        message: `${org.name} 소속 최고승인자로 가입이 완료되었습니다. 바로 로그인 가능합니다.`,
      });
    }
  } catch (error) {
    res.status(500).json({ error: `서버 오류: ${error.message}` });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { gmail } = req.body;
    if (!gmail)
      return res.status(400).json({ message: "Gmail을 입력하십시오." });

    const user = await User.findOne({ gmail });
    if (!user) {
      return res.json({
        message: "Gmail이 등록되어 있다면, 재설정 링크는 이미 발송되었습니다.",
      });
    }

    const token = crypto.randomBytes(20).toString("hex");
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const resetUrl = `https://hg5344-3000.csb.app/reset-password/${token}`;
    await transporter.sendMail({
      from: `"Your App" <${process.env.SMTP_USER}>`,
      to: user.gmail,
      subject: "비밀번호 재설정 안내",
      text: `아래 링크를 클릭하여 비밀번호 재설정(1시간 이내 유효)： ${resetUrl}`,
      html: `<p>아래 링크를 클릭하여 비밀번호 재설정(1시간 이내 유효)： <a href="${resetUrl}">${resetUrl}</a></p>`,
    });

    res.json({
      message: "비밀번호 재설정 Gmail을 보냈습니다, 받은 메일함을 확인하세요",
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "서버 오류입니다. 잠시 후에 다시 시도하십시오" });
  }
};

exports.registerSoldier = async (req, res) => {
  try {
    // 🔥 1. 這裡補上了 enlistmentDate 和 dischargeDate，才能接住前端送來的時間
    const { unitName, name, rank, serviceNumber, phoneNumber, password, enlistmentDate, dischargeDate } = req.body;

    if (!unitName || !name || !rank || !serviceNumber || !phoneNumber || !password) {
      return res.status(400).json({ error: "모든 항목을 입력해 주세요." });
    }

    const org = await Organization.findOne({ name: unitName });
    if (!org) {
      return res.status(404).json({ error: `'${unitName}'은(는) 등록되지 않은 부대입니다.` });
    }

    const existingUser = await User.findOne({
      organizationId: org._id,
      serviceNumber,
    });
    if (existingUser) {
      return res.status(400).json({ error: "해당 부대에 이미 등록된 군번입니다." });
    }

    // 🔥 2. 呼叫檔案最上面的函數，自動幫這名勇士算出退伍日與各階級的晉升日！
    const militaryDates = calculateMilitaryDates(enlistmentDate, dischargeDate, "soldier");

    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔥 3. 存入資料庫時，把算好的日期 (...militaryDates) 一起存進去
    await User.create({
      organizationId: org._id,
      name,
      rank,
      serviceNumber,
      phoneNumber,
      password: hashedPassword,
      role: "soldier",
      status: "pending", // 💡 強烈建議這裡用 "pending"！如果是 "approved"，長官的審核畫面就不會出現這個人了！
      ...militaryDates, 
    });

    res.status(201).json({
      success: true,
      message: `${org.name}에 가입 신청이 완료되었습니다. 관리자 승인 후 로그인 가능합니다.`,
    });
  } catch (error) {
    console.error("일반 가입 에러:", error);
    res.status(500).json({ error: `서버 오류가 발생했습니다. (전화번호 형식 확인)` });
  }
};

exports.getPendingUsers = async (req, res) => {
  try {
    const targetId = req.user.unitId || req.user.orgId;

    if (!targetId) {
      return res
        .status(400)
        .json({ error: "소속 부대 정보가 없습니다. 다시 로그인 해주세요." });
    }

    const users = await User.find({
      $or: [{ unitId: targetId }, { organizationId: targetId }],
      status: "pending",
    }).select("_id name serviceNumber rank createdAt status");

    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: "대기 목록 조회 실패" });
  }
};

exports.approveUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    user.status = "approved";
    await user.save();

    res.json({
      success: true,
      message: `${user.name} 님의 가입이 승인되었습니다.`,
    });
  } catch (error) {
    res.status(500).json({ error: "승인 처리 중 오류 발생" });
  }
};

exports.rejectUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    await User.deleteOne({ _id: user._id });

    res.json({
      success: true,
      message: `${user.name} 가입이 거절되었습니다.`,
    });
  } catch (error) {
    res.status(500).json({ error: "가입 거절 처리 실패" });
  }
};

// =========================================================================
// 🔐 [區塊 C: 設定頁] 使用者自行變更密碼 API
// =========================================================================
exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId).select("+password");
    if (!user)
      return res
        .status(404)
        .json({ success: false, error: "사용자를 찾을 수 없습니다." });

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch)
      return res
        .status(401)
        .json({ success: false, error: "현재 비밀번호가 일치하지 않습니다." });

    if (newPassword.length < 6)
      return res.status(400).json({
        success: false,
        error: "새 비밀번호는 최소 6자리 이상이어야 합니다.",
      });

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedNewPassword;
    user.forceChangePassword = false; // 解除強制修改標記

    await user.save();

    res.json({
      success: true,
      message: "비밀번호가 성공적으로 변경되었습니다.",
    });
  } catch (error) {
    console.error("비밀번호 변경 오류:", error);
    res.status(500).json({
      success: false,
      error: "비밀번호 변경 중 서버 오류가 발생했습니다.",
    });
  }
};

// =========================================================================
// 🚨 [軍隊專屬] 步驟 1：勇士申請重置密碼 (暴力寫入版)
// =========================================================================
exports.requestPasswordReset = async (req, res) => {
  try {
    const { serviceNumber, name } = req.body;
    if (!serviceNumber || !name) {
      return res
        .status(400)
        .json({ success: false, message: "군번과 이름을 모두 입력해주세요." });
    }

    console.log(
      `🚀 [密碼重置] 收到請求 - 軍號: ${serviceNumber}, 姓名: ${name}`
    );

    // 🔥 終極殺招：使用 findOneAndUpdate 強制寫入 $set，無視任何 Schema 快取阻礙！
    const user = await User.findOneAndUpdate(
      { serviceNumber, name },
      { $set: { resetRequested: true } },
      { new: true } // 回傳更新後的最新資料
    );

    if (!user) {
      console.log("❌ [密碼重置] 失敗：找不到該名勇士");
      return res
        .status(404)
        .json({
          success: false,
          message: "입력하신 정보와 일치하는 사용자를 찾을 수 없습니다.",
        });
    }

    console.log(
      `✅ [密碼重置] 成功寫入 DB！目前 resetRequested 狀態: ${user.resetRequested}`
    );

    res.json({
      success: true,
      message:
        "소속 부대 간부에게 비밀번호 초기화 요청이 전송되었습니다. 간부 승인 후 군번으로 로그인할 수 있습니다.",
    });
  } catch (error) {
    console.error("🔥 [密碼重置] 伺服器錯誤:", error);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
};
// =========================================================================
// 🚨 [軍隊專屬] 步驟 2：長官核准重置密碼 (登入後小鈴鐺操作)
// =========================================================================
exports.approvePasswordReset = async (req, res) => {
  try {
    if (!["reviewer", "approver", "superadmin"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ success: false, error: "권한이 없습니다." });
    }

    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) {
      return res
        .status(404)
        .json({ success: false, error: "사용자를 찾을 수 없습니다." });
    }

    // 1. 將密碼重置為他的「軍號」
    const defaultPassword = targetUser.serviceNumber;
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    // 2. 更新狀態
    targetUser.password = hashedPassword;
    targetUser.resetRequested = false; // 解除申請狀態
    targetUser.forceChangePassword = true; // 🔥 強制下次登入必須立刻改密碼！
    targetUser.loginAttempts = 0; // 幫他解除原本可能的 5 次鎖定
    targetUser.lockUntil = null;

    await targetUser.save();

    res.json({
      success: true,
      message: `${targetUser.name} 님의 비밀번호가 군번으로 초기화되었습니다.`,
    });
  } catch (error) {
    console.error("초기화 승인 오류:", error);
    res.status(500).json({
      success: false,
      error: "비밀번호 초기화 승인 중 오류가 발생했습니다.",
    });
  }
};
