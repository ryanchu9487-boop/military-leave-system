const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { loginLimiter } = require("../middlewares/rateLimiter");

// 로그인
router.post("/login", loginLimiter, authController.login);

// 부대 및 관리자 등록
router.post("/register-unit", authController.registerOrganization);

// 비밀번호 찾기
router.post("/forgot-password", authController.forgotPassword);

// 가입 승인 대기 목록
router.get("/pending-users", authMiddleware, authController.getPendingUsers);

// 가입 승인
router.post(
  "/approve-user/:userId",
  authMiddleware,
  authController.approveUser
);

// 가입 거절
router.post("/reject-user/:userId", authMiddleware, authController.rejectUser);

module.exports = router;
