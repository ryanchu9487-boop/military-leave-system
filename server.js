require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const path = require("path");

// 미들웨어 및 모델 불러오기 (리팩토링 반영하여 언더바 _ 제거)
const { globalLimiter } = require("./src/middlewares/rateLimiter");
const { authMiddleware } = require("./src/middlewares/authMiddleware");
const Organization = require("./models/Organization");
const User = require("./models/User");

const app = express();
app.set("trust proxy", 1);

// 🔐 기본 보안 및 미들웨어
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use((req, res, next) => {
  res.removeHeader("Content-Security-Policy");
  next();
});

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// 🔐 전역 요청 제한
app.use(globalLimiter);

// ============================
// MongoDB 연동 및 더미 데이터 생성
// ============================
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB 연결 성공");

    try {
      // =========================
      // 1️⃣ 17포병대대 및 소속 관리자 생성
      // =========================
      const org1Code = "3821";
      const org1Name = "17포병대대";

      let org1 = await Organization.findOne({ orgCode: org1Code });
      if (!org1) {
        org1 = await Organization.create({
          name: org1Name,
          orgCode: org1Code,
          license: {
            maxUsers: 100,
            plan: "pro",
            isPaid: true,
          },
        });
        console.log(`✨ 더미 조직 생성 완료: ${org1Name} (Code: ${org1Code})`);
      }

      // 17포병대대 관리자 계정 생성
      let admin1 = await User.findOne({ serviceNumber: "17-00000000" });
      if (!admin1) {
        admin1 = await User.create({
          organizationId: org1._id,
          name: "홍길동",
          rank: "대위", // 스키마 필수값
          serviceNumber: "17-00000000",
          phoneNumber: "010-0000-0000",
          password: "password0", // 스키마 pre-save 훅에 의해 자동 해싱됨
          role: "admin",
          status: "approved",
        });
        console.log(
          `✨ 더미 관리자 생성 완료: ${admin1.name} (${org1Name}, 군번: ${admin1.serviceNumber})`
        );
      }

      // =========================
      // 2️⃣ 21보병대대 및 소속 관리자 생성
      // =========================
      const org2Code = "9999";
      const org2Name = "21보병대대";

      let org2 = await Organization.findOne({ orgCode: org2Code });
      if (!org2) {
        org2 = await Organization.create({
          name: org2Name,
          orgCode: org2Code,
          license: {
            maxUsers: 50,
            plan: "basic",
            isPaid: false,
          },
        });
        console.log(`✨ 더미 조직 생성 완료: ${org2Name} (Code: ${org2Code})`);
      }

      // 21보병대대 관리자 계정 생성
      let admin2 = await User.findOne({ serviceNumber: "21-00000000" });
      if (!admin2) {
        admin2 = await User.create({
          organizationId: org2._id,
          name: "홍길동",
          rank: "대위", // 스키마 필수값
          serviceNumber: "21-00000000",
          phoneNumber: "010-0000-0000",
          password: "password0",
          role: "admin",
          status: "approved",
        });
        console.log(
          `✨ 더미 관리자 생성 완료: ${admin2.name} (${org2Name}, 군번: ${admin2.serviceNumber})`
        );
      }
    } catch (err) {
      console.error("❌ 더미 데이터 생성 중 오류:", err);
    }
  })
  .catch((err) => console.log("❌ MongoDB 연결 실패:", err));

// ============================
// 👤 사용자 관련 API (누락되었던 부분 복구)
// ============================

// 1. 내 프로필 정보 가져오기
app.get("/profile", authMiddleware, async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      throw new Error("토큰 정보에 userId가 누락되었습니다.");
    }
    const user = await User.findById(req.user.userId)
      .select("_id name serviceNumber role organizationId")
      .populate("organizationId", "name orgCode");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "사용자가 존재하지 않습니다." });
    }
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        orgName: user.organizationId?.name || "소속 없음",
      },
    });
  } catch (err) {
    console.error("Profile API Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. 같은 부대원 목록 가져오기 (출타 모달 대상 인원 등)
app.get("/users", authMiddleware, async (req, res) => {
  try {
    let users;
    if (req.user.role === "superadmin") {
      // ✅ 補上了 status
      users = await User.find().select("_id name serviceNumber role unitId status");
    } else {
      // unitId나 orgId를 기준으로 같은 소속 인원 검색
      const targetId = req.user.unitId || req.user.orgId;
      users = await User.find({
        $or: [{ unitId: targetId }, { organizationId: targetId }],
      }).select("_id name serviceNumber role status"); // ✅ 補上了 status
    }
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================
// 라우터 연결
// ============================
app.use("/", require("./src/routes/authRoutes"));
app.use("/", require("./src/routes/leaveRoutes"));
app.use("/", require("./src/routes/memberRoutes"));

// ============================
// 서버 실행
// ============================
app.listen(3000, "0.0.0.0", () => {
  console.log("🚀 Server running on port 3000 - server.js");
});
