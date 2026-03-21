const rateLimit = require("express-rate-limit");

// 🔐 전역 요청 제한
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

// 🔐 로그인 전용 제한
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: "로그인 시도가 너무 많습니다. 10분 후에 다시 시도하십시오.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  globalLimiter,
  loginLimiter,
};
