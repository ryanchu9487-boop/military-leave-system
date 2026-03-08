const jwt = require("jsonwebtoken");
const Unit = require("../../models/Unit");

// JWT 인증 미들웨어
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "토큰이 제공되지 않았습니다." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // decoded 안에는 { userId, orgId, role } 있음
    req.user = decoded;

    next();
  } catch (err) {
    return res.status(401).json({ message: "유효하지 않은 토큰입니다." });
  }
}

// 구독 플랜 체크 미들웨어
function requirePlan(requiredPlan) {
  return async (req, res, next) => {
    try {
      if (req.user.role === "superadmin") return next();

      const unit = await Unit.findById(req.user.unitId);

      if (!unit) {
        return res.status(404).json({ error: "부대가 존재하지 않습니다." });
      }

      if (unit.subscriptionPlan !== requiredPlan) {
        return res
          .status(403)
          .json({ error: "이 기능은 플랜 업그레이드가 필요합니다." });
      }

      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = {
  authMiddleware,
  requirePlan,
};
