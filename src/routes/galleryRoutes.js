const express = require("express");
const router = express.Router();
const Gallery = require("../../models/Gallery");
const { authMiddleware } = require("../middlewares/authMiddleware");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "../../public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, "gallery-" + Date.now() + "-" + Math.round(Math.random()*1E9) + path.extname(file.originalname))
});

const upload = multer({ 
  storage, 
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('이미지 파일만 업로드 가능합니다.'));
  }
});

// 1. 取得照片列表
router.get("/api/gallery", authMiddleware, async (req, res) => {
  try {
    const photos = await Gallery.find({ organizationId: req.user.orgId })
      // 🔥 修改點：加上晉升日期，供前端動態計算階級
      .populate("uploaderId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
      .populate("reactions.userId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
      .populate("comments.userId", "name rank role promoToIlbyung promoToSangbyung promoToByungjang")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, photos, role: req.user.role, currentUserId: req.user.userId || req.user._id });
  } catch (error) { res.status(500).json({ error: "사진을 불러오는데 실패했습니다." }); }
});

// 2. 上傳新照片 (🔥 支援接收 category)
router.post("/api/gallery", authMiddleware, upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: "이미지 파일이 필요합니다." });
    
    const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
    const newPhotoData = await Gallery.create({
      organizationId: req.user.orgId,
      uploaderId: req.user.userId || req.user._id,
      imageUrls,
      description: req.body.description,
      category: req.body.category || "일상" // 🔥 儲存分類
    });

    const newPhotoPopulated = await Gallery.findById(newPhotoData._id)
        // 🔥 修改點：這裡也要加上晉升日期
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

// 4. 表情回應 (🔥 升級為單一表情切換邏輯)
router.post("/api/gallery/:id/react", authMiddleware, async (req, res) => {
  try {
    const { type } = req.body;
    const photo = await Gallery.findById(req.params.id);
    const userId = req.user.userId || req.user._id;
    
    // 找出這個人「之前有沒有按過」任何表情
    const existingReactionIndex = photo.reactions.findIndex(r => r.userId.toString() === userId.toString());
    
    if (existingReactionIndex > -1) {
      if (photo.reactions[existingReactionIndex].type === type) {
        // 如果按的是一樣的表情 -> 收回
        photo.reactions.splice(existingReactionIndex, 1);
      } else {
        // 如果按的是不一樣的表情 -> 替換成新的
        photo.reactions[existingReactionIndex].type = type;
      }
    } else {
      // 沒按過 -> 直接新增
      photo.reactions.push({ userId, type });
    }
    
    await photo.save();
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "반응 처리 실패" }); }
});

// 5. 🔥 新增：照片留言功能
router.post("/api/gallery/:id/comment", authMiddleware, async (req, res) => {
  try {
    const photo = await Gallery.findById(req.params.id);
    photo.comments.push({ userId: req.user.userId || req.user._id, text: req.body.text });
    await photo.save();
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "댓글 작성 실패" }); }
});

module.exports = router;