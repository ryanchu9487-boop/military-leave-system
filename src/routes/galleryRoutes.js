const express = require("express");
const router = express.Router();
const Gallery = require("../../models/Gallery");
const { authMiddleware } = require("../middlewares/authMiddleware");
const multer = require("multer");
const path = require("path");

// 設定照片上傳 (存放在 public/uploads)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "public/uploads/"),
  filename: (req, file, cb) => cb(null, "gallery-" + Date.now() + path.extname(file.originalname))
});
// 限制只能上傳圖片
const upload = multer({ 
  storage, 
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('이미지 파일만 업로드 가능합니다.'));
  }
});

// 1. 取得照片列表 (包含上傳者、按讚者、留言者資訊)
router.get("/api/gallery", authMiddleware, async (req, res) => {
  try {
    const photos = await Gallery.find({ organizationId: req.user.orgId })
      .populate("uploaderId", "name rank")
      .populate("likes", "name rank")
      .populate("comments.userId", "name rank")
      .sort({ createdAt: -1 })
      .lean();
    
    res.json({ success: true, photos, role: req.user.role, currentUserId: req.user.userId || req.user._id });
  } catch (error) { res.status(500).json({ error: "사진을 불러오는데 실패했습니다." }); }
});

// 2. 上傳新照片 (所有人都可以上傳，不限長官)
router.post("/api/gallery", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "이미지 파일이 필요합니다." });
    const { description } = req.body;
    const newPhoto = await Gallery.create({
      organizationId: req.user.orgId,
      uploaderId: req.user.userId || req.user._id,
      imageUrl: `/uploads/${req.file.filename}`,
      description
    });
    res.json({ success: true, photo: newPhoto });
  } catch (error) { res.status(500).json({ error: "업로드 실패" }); }
});

// 3. 刪除照片 (上傳者本人 或 長官/管理員 可以刪除)
router.delete("/api/gallery/:id", authMiddleware, async (req, res) => {
  try {
    const photo = await Gallery.findById(req.params.id);
    if (!photo) return res.status(404).json({ error: "사진을 찾을 수 없습니다." });
    
    const userId = req.user.userId || req.user._id;
    const isUploader = photo.uploaderId.toString() === userId.toString();
    const isAdmin = ["officer", "reviewer", "approver", "admin", "superadmin"].includes(req.user.role);
    
    if (!isUploader && !isAdmin) return res.status(403).json({ error: "삭제 권한이 없습니다." });
    
    await Gallery.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "삭제 실패" }); }
});

// 4. 照片按讚
router.post("/api/gallery/:id/like", authMiddleware, async (req, res) => {
  try {
    const photo = await Gallery.findById(req.params.id);
    const userId = req.user.userId || req.user._id;
    const likeIndex = photo.likes.indexOf(userId);
    if (likeIndex > -1) photo.likes.splice(likeIndex, 1);
    else photo.likes.push(userId);
    await photo.save();
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "좋아요 처리 실패" }); }
});

// 5. 留言
router.post("/api/gallery/:id/comment", authMiddleware, async (req, res) => {
  try {
    const photo = await Gallery.findById(req.params.id);
    photo.comments.push({ userId: req.user.userId || req.user._id, text: req.body.text });
    await photo.save();
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "댓글 작성 실패" }); }
});

module.exports = router;