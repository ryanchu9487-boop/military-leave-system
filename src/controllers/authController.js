const User = require("../../models/User"); // 사용 중인 User 스키마 확인 (User_ 모델)
const Organization = require("../../models/Organization");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

// 1. 로그인
exports.login = async (req, res) => {
  try {
    const { serviceNumber, password } = req.body;

    // 입력값 확인
    if (!serviceNumber || !password) {
      return res
        .status(400)
        .json({ success: false, message: "군번과 비밀번호를 입력하세요." });
    }

    // 유저 찾기 (비밀번호 포함 호출)
    const user = await User.findOne({ serviceNumber })
      .select("+password")
      .populate("organizationId", "name orgCode");

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "정보가 일치하지 않습니다." });
    }

    // 잠금 상태 확인
    if (user.lockUntil && user.lockUntil > Date.now()) {
      return res
        .status(403)
        .json({ success: false, message: "계정이 잠겨 있습니다." });
    }

    // ✨ 승인 대기 상태(카페 가입 대기) 검사 로직 추가
    if (user.status === "pending") {
      return res.status(403).json({
        error: "관리자 승인 대기 중입니다. 소속 부대 관리자에게 문의하세요.",
      });
    }

    // 비밀번호 확인
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = Date.now() + 10 * 60 * 1000;
      }
      await user.save();
      return res
        .status(401)
        .json({ success: false, message: "비밀번호가 일치하지 않습니다." });
    }

    // 로그인 성공 - 토큰 발급
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
      },
    });
  } catch (error) {
    console.error("Login System Error:", error);
    res
      .status(500)
      .json({ success: false, message: "서버 내부 오류가 발생했습니다." });
  }
};

// 2. 부대 및 관리자 등록
// 2. 부대 및 관리자/용사 자동 등록
exports.registerOrganization = async (req, res) => {
  try {
    const { unitName, name, serviceNumber, phoneNumber, password } = req.body;

    if (!unitName || !name || !serviceNumber || !phoneNumber || !password) {
      return res.status(400).json({ error: "모든 항목을 입력해 주세요." });
    }

    const existingUser = await User.findOne({ serviceNumber });
    if (existingUser) {
      return res.status(400).json({ error: "이미 등록된 군번입니다." });
    }

    const org = await Organization.findOne({ name: unitName });
    if (!org) {
      return res.status(404).json({
        error: `'${unitName}'은(는) 등록되지 않은 부대입니다. 관리자에게 문의하세요.`,
      });
    }

    // ✨ 核心修改：檢查該部隊是否已經有管理員
    const existingAdmin = await User.findOne({
      organizationId: org._id,
      role: { $in: ["admin", "superadmin"] },
    });

    if (existingAdmin) {
      // 該部隊已有管理員 -> 新註冊者以「士兵(soldier)」身份進入「待審核(pending)」狀態
      await User.create({
        organizationId: org._id,
        name: name,
        rank: "용사", // 預設給予勇士軍階，可由管理員後續修改
        serviceNumber: serviceNumber,
        phoneNumber: phoneNumber,
        password: password,
        role: "soldier",
        status: "pending", // ✨ 等待管理員核准
      });

      return res.json({
        message: `${org.name}에 가입 신청이 완료되었습니다. 관리자 승인 후 로그인 가능합니다.`,
      });
    } else {
      // 該部隊還沒有管理員 -> 第一個註冊者直接成為「管理員(admin)」並「自動核准(approved)」
      await User.create({
        organizationId: org._id,
        name: name,
        rank: "관리자",
        serviceNumber: serviceNumber,
        phoneNumber: phoneNumber,
        password: password,
        role: "admin",
        status: "approved", // ✨ 強制設為 approved
        isActive: true,
      });

      return res.json({
        message: `${org.name} 소속 관리자로 가입이 완료되었습니다!`,
      });
    }
  } catch (error) {
    console.error("회원가입 에러:", error);
    res.status(500).json({ error: `서버 오류: ${error.message}` });
  }
};

// 3. 비밀번호 찾기
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
    const { orgCode, name, rank, serviceNumber, phoneNumber, password } =
      req.body;

    if (
      !orgCode ||
      !name ||
      !rank ||
      !serviceNumber ||
      !phoneNumber ||
      !password
    ) {
      return res.status(400).json({ error: "모든 항목을 입력해 주세요." });
    }

    // 부대 코드 확인
    const org = await Organization.findOne({ orgCode: orgCode });
    if (!org) {
      return res.status(404).json({ error: "유효하지 않은 부대 코드입니다." });
    }

    // 해당 부대 내 군번 중복 확인
    const existingUser = await User.findOne({
      organizationId: org._id,
      serviceNumber,
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "해당 부대에 이미 등록된 군번입니다." });
    }

    // 사용자 생성 (스키마 기본값인 status: "pending", role: "soldier" 로 자동 적용)
    await User.create({
      organizationId: org._id,
      name,
      rank,
      serviceNumber,
      phoneNumber,
      password,
      role: "soldier",
      status: "pending",
    });

    res.status(201).json({
      success: true,
      message: `${org.name}에 가입 신청이 완료되었습니다. 관리자 승인 후 로그인 가능합니다.`,
    });
  } catch (error) {
    console.error("일반 가입 에러:", error);
    res
      .status(500)
      .json({ error: `서버 오류가 발생했습니다. (전화번호 형식 확인)` });
  }
};

// 5. [관리자용] 승인 대기 목록 조회
exports.getPendingUsers = async (req, res) => {
  try {
    // ✨ 兼容 unitId 與 orgId
    const targetId = req.user.unitId || req.user.orgId;

    if (!targetId) {
      console.log("❌ Token 에 부대 ID가 없습니다:", req.user);
      return res
        .status(400)
        .json({ error: "소속 부대 정보가 없습니다. 다시 로그인 해주세요." });
    }

    // ✨ 同時比對 organizationId 或 unitId，確保絕對能抓到人
    const users = await User.find({
      $or: [{ unitId: targetId }, { organizationId: targetId }],
      status: "pending",
    }).select("_id name serviceNumber rank createdAt status");

    console.log(
      `✅ 대기자 목록 조회 완료 (부대 ID: ${targetId}): ${users.length}명 찾음`
    );

    res.json({ users });
  } catch (error) {
    console.error("❌ 대기 목록 조회 실패:", error);
    res.status(500).json({ error: "대기 목록 조회 실패" });
  }
};

// 6. [관리자용] 가입 승인 처리
exports.approveUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    // 스키마에 정의된 대로 'approved' 로 변경
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

// 7. [관리자용] 가입 거절
exports.rejectUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        error: "사용자를 찾을 수 없습니다.",
      });
    }

    // 방법1️⃣ : 완전 삭제
    await User.deleteOne({ _id: user._id });

    res.json({
      success: true,
      message: `${user.name} 가입이 거절되었습니다.`,
    });
  } catch (error) {
    console.error("Reject Error:", error);
    res.status(500).json({
      error: "가입 거절 처리 실패",
    });
  }
};
