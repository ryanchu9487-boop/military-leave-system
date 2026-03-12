const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// ==========================================
// 1. 基本認證與註冊 (기본 인증 및 가입)
// ==========================================
router.post("/login", authController.login);
router.post("/register/organization", authController.registerOrganization);
router.post("/register/soldier", authController.registerSoldier);
router.post("/forgot-password", authController.forgotPassword); // 舊版 Email 重置 (保留相容性)

// ==========================================
// 2. 部隊員加入審核管理 (가입 승인 관리)
// ==========================================
router.get("/pending-users", authMiddleware, authController.getPendingUsers);
router.put("/approve-user/:userId", authMiddleware, authController.approveUser);
router.delete(
  "/reject-user/:userId",
  authMiddleware,
  authController.rejectUser
); // 或者是 .put 依您前端為準

// ==========================================
// 3. 🔥 [全新] 密碼安全與長官授權重置機制
// ==========================================

// (1) 使用者自行變更密碼 (對應 settings.html 區塊 C)
router.put("/profile/password", authMiddleware, authController.changePassword);

// (2) 勇士忘記密碼提出申請 (不需登入，對應未來 login.html)
router.post("/auth/request-reset", authController.requestPasswordReset);

// (3) 長官核准密碼重置 (需登入，對應小鈴鐺操作)
router.put(
  "/auth/approve-reset/:userId",
  authMiddleware,
  authController.approvePasswordReset
);

module.exports = router;
