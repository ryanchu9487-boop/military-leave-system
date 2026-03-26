const express = require("express");
const router = express.Router();
const Gallery = require("../../models/Gallery");
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

// 🔥 設定 Cloudinary 儲存庫 (自動判斷格式防彈版)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: 'smartmil/gallery', // 存到雲端上的 smartmil/gallery 資料夾
      resource_type: 'auto'       // 交給雲端自動判斷，最不容易報錯！
    };
  }
});
const upload = multer({ storage: storage });

// 1. 取得照片列表
router.get("/api/gallery", authMiddleware, async (req, res) => {
  try {
    const photos = await Gallery.find({ organizationId: req.user.orgId })
      .populate("uploaderId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
      .populate("reactions.userId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
      .populate("comments.userId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, photos, role: req.user.role, currentUserId: req.user.userId || req.user._id });
  } catch (error) { res.status(500).json({ error: "사진을 불러오는데 실패했습니다." }); }
});

// 2. 上傳新照片
router.post("/api/gallery", authMiddleware, upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: "이미지 파일이 필요합니다." });
    
    // 🔥 神奇魔法：Cloudinary 直接給我們完整網址 file.path！
    const imageUrls = req.files.map(file => file.path);
    
    const newPhotoData = await Gallery.create({
      organizationId: req.user.orgId,
      uploaderId: req.user.userId || req.user._id,
      imageUrls,
      description: req.body.description,
      category: req.body.category || "일상"
    });

    const newPhotoPopulated = await Gallery.findById(newPhotoData._id)
        .populate("uploaderId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
        .populate("reactions.userId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
        .populate("comments.userId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
        .lean();

    res.json({ success: true, photo: newPhotoPopulated });
  } catch (error) { 
    res.status(500).json({ error: "업로드 중 오류가 발생했습니다." }); 
  }
});

// 3. 刪除照片
router.delete("/api/gallery/:id", authMiddleware, async (req, res) => {
  try {
    const photo = await Gallery.findById(req.params.id);
    const userId = req.user.userId || req.user._id;
    if (photo.uploaderId.toString() !== userId.toString() && !["officer", "reviewer", "approver", "admin", "superadmin"].includes(req.user.role)) {
      return res.status(403).json({ error: "삭제 권한이 없습니다." });
    }
    await Gallery.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "삭제 실패" }); }
});

// 4. 表情回應
router.post("/api/gallery/:id/react", authMiddleware, async (req, res) => {
  try {
    const { type } = req.body;
    const photo = await Gallery.findById(req.params.id);
    const userId = req.user.userId || req.user._id;
    
    const existingReactionIndex = photo.reactions.findIndex(r => r.userId.toString() === userId.toString());
    
    if (existingReactionIndex > -1) {
      if (photo.reactions[existingReactionIndex].type === type) {
        photo.reactions.splice(existingReactionIndex, 1);
      } else {
        photo.reactions[existingReactionIndex].type = type;
      }
    } else {
      photo.reactions.push({ userId, type });
    }
    
    await photo.save();
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "반응 처리 실패" }); }
});

// 5. 照片留言功能
router.post("/api/gallery/:id/comment", authMiddleware, async (req, res) => {
  try {
    const photo = await Gallery.findById(req.params.id);
    photo.comments.push({ userId: req.user.userId || req.user._id, text: req.body.text });
    await photo.save();
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "댓글 작성 실패" }); }
});

module.exports = router;