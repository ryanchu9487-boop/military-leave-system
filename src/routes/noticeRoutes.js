const express = require("express");
const router = express.Router();
const Notice = require("../../models/Notice");
const { authMiddleware } = require("../middlewares/authMiddleware");
const multer = require("multer");
const path = require("path");

// 🔥 設定檔案上傳 (Multer)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads/"); // 確保你有這個資料夾
  },
  filename: (req, file, cb) => {
    // 檔名前面加上時間戳記避免重複
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage });

// 1. 獲取公告列表
router.get("/api/notices", authMiddleware, async (req, res) => {
  try {
    const notices = await Notice.find({ organizationId: req.user.orgId })
      .populate("authorId", "name rank")
      .populate("comments.userId", "name rank")
      .populate("likes", "name rank") // 🔥 新增這行：把按讚的人的名字與階級抓出來
      .sort({ isImportant: -1, createdAt: -1 })
      .lean();
    
    res.json({ success: true, notices, role: req.user.role, currentUserId: req.user.userId || req.user._id });
  } catch (error) {
    res.status(500).json({ error: "공지사항을 불러오는데 실패했습니다." });
  }
});

// 2. 新增公告 (🔥 支援上傳多個檔案)
router.post("/api/notices", authMiddleware, upload.array("files", 5), async (req, res) => {
  try {
    const { role, orgId, userId } = req.user;
    if (!["officer", "reviewer", "approver", "admin", "superadmin"].includes(role)) {
      return res.status(403).json({ error: "공지사항 작성 권한이 없습니다." });
    }
    
    const { title, content, isImportant } = req.body;
    
    // 整理上傳的檔案路徑
    const attachedFiles = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

    const newNotice = await Notice.create({ 
      organizationId: orgId, 
      authorId: userId, 
      title, 
      content, 
      isImportant: isImportant === 'true', // FormData 傳過來會是字串
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