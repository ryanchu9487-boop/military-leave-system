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

// 🔥 [新增] 啟動 EJS 模板引擎
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

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

app.use(express.json({ limit: "50mb" })); // 已經放大到 50mb
app.use(express.urlencoded({ limit: "50mb", extended: true })); // 已經放大到 50mb
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
          license: { maxUsers: 100, plan: "pro", isPaid: true },
        });
        console.log(`✨ 더미 조직 생성 완료: ${org1Name} (Code: ${org1Code})`);
      }

      // 🔥 17포병대대 홍길동 강제 복구 (強制恢復大尉與核准者身分！)
      await User.findOneAndUpdate(
        { serviceNumber: "17-00000000" },
        {
          $set: {
            organizationId: org1._id,
            name: "홍길동",
            rank: "대위", // 討回大尉階級！
            phoneNumber: "010-0000-0000",
            role: "approver", // 🔥 設定為 승인자 (核准者)
            status: "approved",
          },
          $setOnInsert: { password: "password0" }
        },
        { upsert: true }
      );
      console.log(`✨ 홍길동(17포병대대) 대위/승인자 복구 완료!`);

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
          license: { maxUsers: 50, plan: "basic", isPaid: false },
        });
        console.log(`✨ 더미 조직 생성 완료: ${org2Name} (Code: ${org2Code})`);
      }

      // 🔥 21보병대대 홍길동 강제 복구
      await User.findOneAndUpdate(
        { serviceNumber: "21-00000000" },
        {
          $set: {
            organizationId: org2._id,
            name: "홍길동",
            rank: "대위", // 討回大尉階級！
            phoneNumber: "010-0000-0000",
            role: "approver", // 🔥 設定為 승인자 (核准者)
            status: "approved",
          },
          $setOnInsert: { password: "password0" }
        },
        { upsert: true }
      );
      console.log(`✨ 홍길동(21보병대대) 대위/승인자 복구 완료!`);

    // 🔥 [這裡就是你漏掉的括號！我補回來了！]
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

// ==========================================
// 👤 [修復版] 小鈴鐺通知 (直接在 server.js 修改)
// ==========================================
app.get("/leaves/notifications", authMiddleware, async (req, res) => {
  // 強制不緩存，解決 304 問題
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    const mongoose = require("mongoose");
    const userId = req.user.userId || req.user._id;
    const orgId = req.user.orgId;
    const role = req.user.role;

    // 1. 強制轉型，防止查詢失敗
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const orgObjectId = new mongoose.Types.ObjectId(orgId);

    // 2. 抓取當前使用者 (Header 顯示用)
    const currentUser = await User.findById(userObjectId).populate("organizationId");
    
    // 🛡️ 防呆：如果抓不到人，給個預設值，防止 Header 壞掉
    const safeUserInfo = {
      name: currentUser?.name || "사용자",
      role: currentUser?.role || role,
      unitName: currentUser?.organizationId?.name || "소속 없음"
    };

    let notifications = [];

    // 3. 根據角色抓取通知
    if (role === "reviewer" || role === "officer") {
      const leaves = await Leave.find({
        organizationId: orgObjectId,
        status: { $in: ["PENDING_REVIEW", "CANCEL_REQ_REVIEW"] },
      }).populate("userId", "name rank").lean();
      notifications.push(...leaves);
    } 
    else if (role === "approver" || role === "superadmin") {
      const leaves = await Leave.find({
        organizationId: orgObjectId,
        status: { $in: ["PENDING_APPROVAL", "CANCEL_REQ_APPROVAL"] },
      }).populate("userId", "name rank").lean();
      notifications.push(...leaves);
    } 
    else if (role === "soldier") {
      // 🔥 關鍵修正：這裡一定要包含 CANCEL_APPROVED
      const leaves = await Leave.find({
        userId: userObjectId,
        status: { $in: ["REJECTED_REVIEW", "REJECTED_APPROVAL", "CANCEL_APPROVED"] },
      }).populate("userId", "name rank").lean();
      notifications.push(...leaves);
    }

    // 4. 長官額外通知 (新兵、退伍)
    if (["reviewer", "approver", "admin", "superadmin", "officer"].includes(role)) {
      const [pendingUsers, dischargingUsers] = await Promise.all([
        User.find({ organizationId: orgObjectId, status: "pending" }).lean(),
        User.find({
          organizationId: orgObjectId,
          status: "approved",
          dischargeDate: { 
            $gte: new Date(new Date().setHours(0,0,0,0)), 
            $lt: new Date(new Date().setHours(23,59,59,999)) 
          }
        }).lean()
      ]);

      pendingUsers.forEach(pu => notifications.push({
        _id: pu._id, status: "NEW_MEMBER_PENDING", reason: "신규 가입 승인 대기", userId: { name: pu.name }, createdAt: pu.createdAt
      }));
      dischargingUsers.forEach(du => notifications.push({
        _id: du._id, status: "DISCHARGE_TODAY", reason: "오늘 전역 예정", userId: { name: du.name }, createdAt: new Date()
      }));
    }

    // 5. 排序：依照 updatedAt 或 createdAt
    notifications.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));

    // 6. 回傳
    res.json({
      success: true,
      userInfo: safeUserInfo,
      notifications,
    });

  } catch (error) {
    console.error("🔔 Notifications API Error:", error);
    // 即使報錯也回傳基本的 userInfo，確保 Header 不會壞掉
    res.status(500).json({ 
      success: false, 
      userInfo: { name: "오류", role: "error", unitName: "" },
      error: "알림 정보를 불러오는데 실패했습니다." 
    });
  }
});

// ============================
// 라우터 연결
// ============================
app.use("/", require("./src/routes/authRoutes"));
app.use("/", require("./src/routes/leaveRoutes"));
app.use("/", require("./src/routes/memberRoutes"));
app.use("/", require("./src/routes/noticeRoutes"));
app.use("/", require("./src/routes/galleryRoutes"));
app.use(require('./src/routes/letterRoutes'));


// ============================
// 🔥 [新增] EJS 網頁渲染路由
// (為了不破壞您原本的網址，我們讓 .html 的網址也能對應到 .ejs 檔案)
// ============================
app.get(["/", "/index.html"], (req, res) => res.render("index"));
app.get("/login.html", (req, res) => res.render("login"));
app.get("/settings.html", (req, res) => res.render("settings"));
app.get("/adduser.html", (req, res) => res.render("adduser"));
app.get("/review.html", (req, res) => res.render("review"));
app.get("/approve.html", (req, res) => res.render("approve"));
app.get("/notice", (req, res) => res.render("notice"));
app.get("/gallery", (req, res) => res.render("gallery"));
app.get("/letter", (req, res) => {res.render("letter");});

// 渲染 1차 검토 (Review) 頁面
app.get('/review', (req, res) => {
    res.render('review'); 
});

// 渲染 최종 승인 (Approve) 頁面
app.get('/approve', (req, res) => {
    res.render('approve'); 
});

// 如果你的 adduser 也是 ejs，順便確認有沒有這行
app.get('/adduser', (req, res) => {
    res.render('adduser'); 
});

// ============================
// 서버 실행
// ============================
app.listen(3000, "0.0.0.0", () => {
  console.log("🚀 Server running on port 3000 - server.js");
});