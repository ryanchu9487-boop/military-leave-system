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
const Leave = require("./models/Leave");

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

// 🔥 [這裡加上了！] 明確開放 uploads 資料夾的讀取權限，解決 Cannot GET 錯誤
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

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

// 1. 내 프로필 정보 가져오기 (🔥 수리 완료: 프론트엔드에 필요한 모든 데이터 포함)
app.get("/profile", authMiddleware, async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      throw new Error("토큰 정보에 userId가 누락되었습니다.");
    }
    
    // 🔥 修改 1：使用 .select("-password") 排除密碼，其他資料全部拿出來！
    const user = await User.findById(req.user.userId)
      .select("-password") 
      .populate("organizationId", "name orgCode");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "사용자가 존재하지 않습니다." });
    }
    
    // 🔥 修改 2：把所有前端設定頁 (settings.html) 需要的欄位全部打包送出去！
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        rank: user.rank, // 階級
        serviceNumber: user.serviceNumber, // 軍番
        role: user.role,
        orgName: user.organizationId?.name || "소속 없음",
        forceChangePassword: user.forceChangePassword, // 強制改密碼警告
        
        // 📅 軍隊專屬日期 (進度條與晉升計算的核心)
        enlistmentDate: user.enlistmentDate,
        dischargeDate: user.dischargeDate,
        promoToIlbyung: user.promoToIlbyung,
        promoToSangbyung: user.promoToSangbyung,
        promoToByungjang: user.promoToByungjang,
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
      users = await User.find().select(
        "_id name serviceNumber role unitId status"
      );
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

app.get("/leaves/notifications", authMiddleware, async (req, res) => {
  try {
    // 從 authMiddleware 解析出來的 user 資料中取得 userId 與 role
    const userId = req.user.userId || req.user._id;
    const orgId = req.user.orgId;
    const role = req.user.role;

    // 1. 抓取當前使用者資訊 (為了顯示右上角的姓名與階級)
    const currentUser = await User.findById(userId).populate("organizationId");
    if (!currentUser) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    let notifications = [];

    // ==========================================
    // 🟢 2. 休假申請 & 取消審核通知 (原本的)
    // ==========================================
   if (role === "reviewer") {
      const leaves = await Leave.find({
        organizationId: orgId,
        status: { $in: ["PENDING_REVIEW", "CANCEL_REQ_REVIEW"] },
      })
        .populate("userId", "name rank serviceNumber") // ✅ 加上 rank 和 serviceNumber
        .lean();
      notifications.push(...leaves);
    } else if (role === "approver" || role === "superadmin") {
      const leaves = await Leave.find({
        organizationId: orgId,
        status: { $in: ["PENDING_APPROVAL", "CANCEL_REQ_APPROVAL"] },
      })
        .populate("userId", "name rank serviceNumber") // ✅ 加上 rank 和 serviceNumber
        .lean();
      notifications.push(...leaves);
    } else if (role === "soldier") {
      const leaves = await Leave.find({
        userId: userId,
        status: { $in: ["REJECTED_REVIEW", "REJECTED_APPROVAL"] },
      })
        .populate("userId", "name rank serviceNumber") // ✅ 加上 rank 和 serviceNumber
        .lean();
      notifications.push(...leaves);
    }

    // ==========================================
    // 🟡 3. 新兵審核 & 退伍老兵 通知 (新功能)
    // ==========================================
    if (["reviewer", "approver", "admin", "superadmin"].includes(role)) {
      // A. 新兵待審核
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

      // B. 今日退伍
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
          createdAt: new Date(), // 給定一個當下時間來排序
        });
      });
    }

    // 4. 將所有通知依照時間排序 (最新的在最上面)
    notifications.sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

    // 5. 完美回傳給前端
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
    console.error("🔔 알림 API 오류:", error);
    res.status(500).json({ error: "알림 정보를 불러오는데 실패했습니다." });
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