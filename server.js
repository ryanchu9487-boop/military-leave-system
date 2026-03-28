require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs"); // 🔥 新增：處理檔案系統
const multer = require("multer"); // 🔥 新增：處理圖片上傳

// 미들웨어 및 모델 불러오기
const { globalLimiter } = require("./src/middlewares/rateLimiter");
const { authMiddleware } = require("./src/middlewares/authMiddleware");
const Organization = require("./models/Organization");
const User = require("./models/User");
const Leave = require("./models/Leave");
const Notice = require("./models/Notice"); // 🔥 新增：載入公告模型

const app = express();

// 🔥 啟動 EJS 模板引擎
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

app.use(express.json({ limit: "50mb" })); 
app.use(express.urlencoded({ limit: "50mb", extended: true })); 
app.use(express.static(path.join(__dirname, "public")));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// 🔐 전역 요청 제한
app.use(globalLimiter);

// 🔥 [新增] multer 檔案上傳設定 (解決 PUT/POST 找不到 upload 的問題)
const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname))
});
const upload = multer({ storage });

// ============================
// MongoDB 연동 및 더미 데이터 생성
// ============================
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB 연결 성공");
    try {
      const org1Code = "3821";
      const org1Name = "17포병대대";
      let org1 = await Organization.findOne({ orgCode: org1Code });
      if (!org1) {
        org1 = await Organization.create({ name: org1Name, orgCode: org1Code, license: { maxUsers: 100, plan: "pro", isPaid: true } });
        console.log(`✨ 더미 조직 생성 완료: ${org1Name} (Code: ${org1Code})`);
      }

      await User.findOneAndUpdate(
        { serviceNumber: "17-00000000" },
        { $set: { organizationId: org1._id, name: "홍길동", rank: "대위", phoneNumber: "010-0000-0000", role: "approver", status: "approved" }, $setOnInsert: { password: "password0" } },
        { upsert: true }
      );

      const org2Code = "9999";
      const org2Name = "21보병대대";
      let org2 = await Organization.findOne({ orgCode: org2Code });
      if (!org2) {
        org2 = await Organization.create({ name: org2Name, orgCode: org2Code, license: { maxUsers: 50, plan: "basic", isPaid: false } });
        console.log(`✨ 더미 조직 생성 완료: ${org2Name} (Code: ${org2Code})`);
      }

      await User.findOneAndUpdate(
        { serviceNumber: "21-00000000" },
        { $set: { organizationId: org2._id, name: "홍길동", rank: "대위", phoneNumber: "010-0000-0000", role: "approver", status: "approved" }, $setOnInsert: { password: "password0" } },
        { upsert: true }
      );
    } catch (err) { console.error("❌ 더미 데이터 생성 중 오류:", err); }
  })
  .catch((err) => console.log("❌ MongoDB 연결 실패:", err));

// ============================
// 👤 사용자 관련 API
// ============================
app.get("/profile", authMiddleware, async (req, res) => {
  try {
    if (!req.user || !req.user.userId) throw new Error("토큰 정보에 userId가 누락되었습니다.");
    const user = await User.findById(req.user.userId).select("-password").populate("organizationId", "name orgCode");
    if (!user) return res.status(404).json({ success: false, message: "사용자가 존재하지 않습니다." });
    
    res.json({
      success: true,
      user: {
        id: user._id, name: user.name, rank: user.rank, serviceNumber: user.serviceNumber,
        role: user.role, orgName: user.organizationId?.name || "소속 없음", forceChangePassword: user.forceChangePassword,
        enlistmentDate: user.enlistmentDate, dischargeDate: user.dischargeDate,
        promoToIlbyung: user.promoToIlbyung, promoToSangbyung: user.promoToSangbyung, promoToByungjang: user.promoToByungjang,
      },
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get("/users", authMiddleware, async (req, res) => {
  try {
    let users;
    if (req.user.role === "superadmin") {
      users = await User.find().select("_id name serviceNumber role unitId status");
    } else {
      const targetId = req.user.unitId || req.user.orgId;
      users = await User.find({ $or: [{ unitId: targetId }, { organizationId: targetId }] }).select("_id name serviceNumber role status"); 
    }
    res.json({ users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 📢 [升級版] 공지사항 (公告) API - 智能排序與修改支援
// ==========================================

// 1. 取得公告列表 (智能排序：必讀置頂 3 天)
app.get("/api/notices", authMiddleware, async (req, res) => {
  try {
    const allNotices = await Notice.find({ organizationId: req.user.orgId })
      .populate("authorId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
      .populate("comments.userId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
      .populate("likes", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
      .lean();

    const today = new Date();
    const expiryDays = 3; // 必讀公告置頂 3 天限制

    const sortedNotices = allNotices.sort((a, b) => {
      const aIsSticky = a.isImportant && (today - new Date(a.createdAt)) < (expiryDays * 24 * 60 * 60 * 1000);
      const bIsSticky = b.isImportant && (today - new Date(b.createdAt)) < (expiryDays * 24 * 60 * 60 * 1000);

      if (aIsSticky && !bIsSticky) return -1; // A 置頂
      if (!aIsSticky && bIsSticky) return 1;  // B 置頂
      return new Date(b.createdAt) - new Date(a.createdAt); // 預設按時間反序
    });

    res.json({ success: true, role: req.user.role, currentUserId: req.user.userId || req.user._id, notices: sortedNotices });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 2. 新增公告
app.post("/api/notices", authMiddleware, upload.array("files", 5), async (req, res) => {
  try {
    const fileUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];
    const newNotice = new Notice({
      organizationId: req.user.orgId, authorId: req.user.userId || req.user._id,
      title: req.body.title, content: req.body.content, isImportant: req.body.isImportant === "true", attachedFiles: fileUrls
    });
    await newNotice.save();
    res.json({ success: true, notice: newNotice });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 3. 修改公告 (PUT)
app.put("/api/notices/:id", authMiddleware, upload.array("files", 5), async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id);
    if (!notice) return res.status(404).json({ error: "공지를 찾을 수 없습니다." });
    
    const authorStr = notice.authorId._id ? notice.authorId._id.toString() : notice.authorId.toString();
    const reqUserStr = (req.user.userId || req.user._id).toString();

    if (authorStr !== reqUserStr && !['superadmin', 'admin', 'approver'].includes(req.user.role)) {
        return res.status(403).json({ error: "권한이 없습니다." });
    }

    notice.title = req.body.title; notice.content = req.body.content; notice.isImportant = req.body.isImportant === "true";
    if (req.files && req.files.length > 0) notice.attachedFiles = req.files.map(f => `/uploads/${f.filename}`);
    
    await notice.save();
    res.json({ success: true, notice });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ==========================================
// ✏️ [新增] 留言與相簿修改 API
// ==========================================

// 1. 修改公告留言 (PUT)
app.put("/api/notices/:noticeId/comment/:commentId", authMiddleware, async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.noticeId);
    if (!notice) return res.status(404).json({ error: "공지를 찾을 수 없습니다." });
    
    // 找出該筆留言
    const comment = notice.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: "댓글을 찾을 수 없습니다." });

    // 檢查權限：只有留言本人可以修改
    if (comment.userId.toString() !== (req.user.userId || req.user._id).toString()) {
      return res.status(403).json({ error: "수정 권한이 없습니다." });
    }

    comment.text = req.body.text; // 更新留言內容
    await notice.save();
    res.json({ success: true, notice });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 2. 修改相簿貼文 (PUT)
app.put("/api/gallery/:id", authMiddleware, upload.array("images", 10), async (req, res) => {
  try {
    const GalleryModel = mongoose.models.Gallery;
    if(!GalleryModel) return res.status(500).json({ error: "Gallery Model Error" });

    const gallery = await GalleryModel.findById(req.params.id);
    if (!gallery) return res.status(404).json({ error: "사진을 찾을 수 없습니다." });

    const authorStr = gallery.uploaderId ? gallery.uploaderId.toString() : '';
    const reqUserStr = (req.user.userId || req.user._id).toString();

    // 檢查權限：發佈者本人或長官
    if (authorStr !== reqUserStr && !['superadmin', 'admin', 'approver'].includes(req.user.role)) {
        return res.status(403).json({ error: "권한이 없습니다." });
    }

    gallery.category = req.body.category || gallery.category;
    gallery.description = req.body.description || gallery.description;
    
    // 如果有重新上傳圖片，就覆蓋舊圖
    if (req.files && req.files.length > 0) {
        gallery.imageUrls = req.files.map(f => `/uploads/${f.filename}`);
    }

    await gallery.save();
    res.json({ success: true, gallery });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 3. 修改相簿留言 (PUT)
app.put("/api/gallery/:galleryId/comment/:commentId", authMiddleware, async (req, res) => {
  try {
    const GalleryModel = mongoose.models.Gallery;
    const gallery = await GalleryModel.findById(req.params.galleryId);
    if (!gallery) return res.status(404).json({ error: "사진을 찾을 수 없습니다." });

    const comment = gallery.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: "댓글을 찾을 수 없습니다." });

    // 檢查權限：只有留言本人可以修改
    if (comment.userId.toString() !== (req.user.userId || req.user._id).toString()) {
      return res.status(403).json({ error: "수정 권한이 없습니다." });
    }

    comment.text = req.body.text;
    await gallery.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 4. 刪除、按讚、留言...
app.delete("/api/notices/:id", authMiddleware, async (req, res) => {
    try { await Notice.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});
app.post("/api/notices/:id/like", authMiddleware, async (req, res) => {
    try {
        const notice = await Notice.findById(req.params.id);
        const userId = req.user.userId || req.user._id;
        const index = notice.likes.indexOf(userId);
        if (index > -1) notice.likes.splice(index, 1); else notice.likes.push(userId);
        await notice.save(); res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.post("/api/notices/:id/comment", authMiddleware, async (req, res) => {
    try {
        const notice = await Notice.findById(req.params.id);
        notice.comments.push({ userId: req.user.userId || req.user._id, text: req.body.text });
        await notice.save(); res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 🔔 [升級版] 小鈴鐺通知 (加入必讀公告推播)
// ==========================================
app.get("/leaves/notifications", authMiddleware, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    const userId = req.user.userId || req.user._id;
    const orgId = req.user.orgId;
    const role = req.user.role;

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const orgObjectId = new mongoose.Types.ObjectId(orgId);

    const currentUser = await User.findById(userObjectId).populate("organizationId");
    const safeUserInfo = { name: currentUser?.name || "사용자", role: currentUser?.role || role, unitName: currentUser?.organizationId?.name || "소속 없음" };

    let notifications = [];

    // 1. 假單審核通知
    if (role === "reviewer" || role === "officer") {
      const leaves = await Leave.find({ organizationId: orgObjectId, status: { $in: ["PENDING_REVIEW", "CANCEL_REQ_REVIEW"] } }).populate("userId", "name rank").lean();
      notifications.push(...leaves);
    } else if (role === "approver" || role === "superadmin") {
      const leaves = await Leave.find({ organizationId: orgObjectId, status: { $in: ["PENDING_APPROVAL", "CANCEL_REQ_APPROVAL"] } }).populate("userId", "name rank").lean();
      notifications.push(...leaves);
    } else if (role === "soldier") {
      const leaves = await Leave.find({ userId: userObjectId, status: { $in: ["REJECTED_REVIEW", "REJECTED_APPROVAL", "CANCEL_APPROVED"] } }).populate("userId", "name rank").lean();
      notifications.push(...leaves);
    }

    // 2. 長官額外通知 (新兵、退伍)
    if (["reviewer", "approver", "admin", "superadmin", "officer"].includes(role)) {
      const [pendingUsers, dischargingUsers] = await Promise.all([
        User.find({ organizationId: orgObjectId, status: "pending" }).lean(),
        User.find({ organizationId: orgObjectId, status: "approved", dischargeDate: { $gte: new Date(new Date().setHours(0,0,0,0)), $lt: new Date(new Date().setHours(23,59,59,999)) } }).lean()
      ]);
      pendingUsers.forEach(pu => notifications.push({ _id: pu._id, status: "NEW_MEMBER_PENDING", reason: "신규 가입 승인 대기", userId: { name: pu.name }, createdAt: pu.createdAt }));
      dischargingUsers.forEach(du => notifications.push({ _id: du._id, status: "DISCHARGE_TODAY", reason: "오늘 전역 예정", userId: { name: du.name }, createdAt: new Date() }));
    }

    // 🔥 3. 全連隊推播：抓取近 3 天內的「必讀公告」
    const recentImportantNotices = await Notice.find({
      organizationId: orgObjectId,
      isImportant: true,
      createdAt: { $gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }
    }).populate("authorId", "name rank").lean();

    recentImportantNotices.forEach(notice => {
      const authorStr = notice.authorId && notice.authorId._id ? notice.authorId._id.toString() : notice.authorId?.toString();
      // 不要發通知給發佈者本人
      if (authorStr !== userObjectId.toString()) {
        notifications.push({
          _id: notice._id,
          status: "SYSTEM_NOTICE", // 自訂狀態碼
          reason: `[필독] ${notice.title}`,
          userId: notice.authorId,
          createdAt: notice.createdAt,
          type: "NOTICE"
        });
      }
    });

    // 4. 排序並回傳
    notifications.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    res.json({ success: true, userInfo: safeUserInfo, notifications });

  } catch (error) {
    console.error("🔔 Notifications API Error:", error);
    res.status(500).json({ success: false, userInfo: { name: "오류", role: "error", unitName: "" }, error: "알림 정보를 불러오는데 실패했습니다." });
  }
});

// ==========================================
// 🔍 全局魔法搜尋引擎 (Omni-Search API)
// ==========================================
app.get("/api/omni-search", authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length === 0) return res.json({ success: true, results: [] });

    const keyword = q.trim();
    const regex = new RegExp(keyword, "i");
    const { orgId } = req.user;

    const GalleryModel = mongoose.models.Gallery; 

    const matchedUsers = await User.find({
      organizationId: orgId, status: "approved", $or: [{ name: regex }, { serviceNumber: regex }]
    }).select("_id name rank role promoToIlbyung promoToSangbyung promoToByungjang status").lean();
    const matchedUserIds = matchedUsers.map(u => u._id);

    const [leaves, notices, galleries] = await Promise.all([
      Leave.find({
        organizationId: orgId, status: { $nin: ["CANCELLED"] },
        $or: [{ reason: regex }, { type: regex }, { userId: { $in: matchedUserIds } }]
      }).populate("userId", "name rank").sort({ startDate: -1 }).limit(5).lean(),
      
      Notice.find({
        organizationId: orgId, $or: [{ title: regex }, { content: regex }] 
      }).select("_id title createdAt").sort({ createdAt: -1 }).limit(3).lean(),

      GalleryModel ? GalleryModel.find({
        organizationId: orgId, $or: [{ title: regex }, { description: regex }, { content: regex }] 
      }).select("_id title createdAt").sort({ createdAt: -1 }).limit(3).lean() : Promise.resolve([])
    ]);

    const usersToDisplay = matchedUsers.filter(u => u.status === "approved").slice(0, 4);
    res.json({ success: true, results: { users: usersToDisplay, leaves, notices, galleries } });
  } catch (error) {
    console.error("Omni-Search Error:", error);
    res.status(500).json({ success: false, error: "검색 중 오류 발생" });
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
// 網頁渲染路由
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
app.get('/review', (req, res) => { res.render('review'); });
app.get('/approve', (req, res) => { res.render('approve'); });
app.get('/adduser', (req, res) => { res.render('adduser'); });

// ============================
// 서버 실행
// ============================
app.listen(3000, "0.0.0.0", () => {
  console.log("🚀 Server running on port 3000 - server.js");
});