const express = require("express");
const router = express.Router();
const Notice = require("../../models/Notice");
const { authMiddleware } = require("../middlewares/authMiddleware");
const multer = require("multer");

// 🔥 引入 Cloudinary 套件
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// 🔥 設定 Cloudinary 鑰匙
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 🔥 設定 Cloudinary 儲存庫 (支援圖片與文件)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: 'smartmil/notices', // 存到雲端上的 smartmil/notices 資料夾
      resource_type: 'auto',      // 自動判斷是圖片還是文件
      public_id: Date.now() + "-" + Math.round(Math.random() * 1e9)
    };
  }
});
const upload = multer({ storage: storage });

// 1. 獲取公告列表
router.get("/api/notices", authMiddleware, async (req, res) => {
  try {
    const notices = await Notice.find({ organizationId: req.user.orgId })
      .populate("authorId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
      .populate("comments.userId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
      .populate("likes", "name rank role promoToIlbyung promoToSangbyung promoToByungjang") 
      .sort({ isImportant: -1, _id: -1 })
      .lean();

    res.json({ success: true, notices, role: req.user.role, currentUserId: req.user.userId || req.user._id });
  } catch (error) {
    res.status(500).json({ error: "공지사항을 불러오는데 실패했습니다." });
  }
});

// 2. 新增公告
router.post("/api/notices", authMiddleware, upload.array("files", 5), async (req, res) => {
  try {
    const { role, orgId, userId } = req.user;
    if (!["officer", "reviewer", "approver", "admin", "superadmin"].includes(role)) {
      return res.status(403).json({ error: "공지사항 작성 권한이 없습니다." });
    }
    
    const { title, content, isImportant } = req.body;
    
    // 🔥 神奇魔法：Cloudinary 直接給我們完整網址 file.path！
    const attachedFiles = req.files ? req.files.map(file => file.path) : [];

    const newNotice = await Notice.create({ 
      organizationId: orgId, 
      authorId: userId, 
      title, 
      content, 
      isImportant: isImportant === 'true',
      attachedFiles 
    });
    
    res.json({ success: true, notice: newNotice });
  } catch (error) {
    res.status(500).json({ error: "공지사항 작성에 실패했습니다." });
  }
});

// 3. 刪除公告
router.delete("/api/notices/:id", authMiddleware, async (req, res) => {
  try {
    const { role } = req.user;
    if (!["officer", "reviewer", "approver", "admin", "superadmin"].includes(role)) return res.status(403).json({ error: "삭제 권한이 없습니다." });
    await Notice.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "삭제 실패" }); }
});

// 4. 按讚 / 取消按讚
router.post("/api/notices/:id/like", authMiddleware, async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id);
    if (!notice) return res.status(404).json({ error: "공지를 찾을 수 없습니다." });
    
    const userId = req.user.userId || req.user._id;
    const likeIndex = notice.likes.indexOf(userId);
    if (likeIndex > -1) notice.likes.splice(likeIndex, 1);
    else notice.likes.push(userId);
    
    await notice.save();
    res.json({ success: true, likes: notice.likes });
  } catch (error) { res.status(500).json({ error: "좋아요 처리 실패" }); }
});

// 5. 新增留言
router.post("/api/notices/:id/comment", authMiddleware, async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id);
    if (!notice) return res.status(404).json({ error: "공지를 찾을 수 없습니다." });
    
    notice.comments.push({ userId: req.user.userId || req.user._id, text: req.body.text });
    await notice.save();
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "댓글 작성 실패" }); }
});

module.exports = router;