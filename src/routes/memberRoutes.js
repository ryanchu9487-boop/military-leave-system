const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middlewares/authMiddleware");
const User = require("../../models/User");

// 1. [부대원 관리] 기존 부대원 목록 불러오기 (승인된 사용자)
router.get("/users", authMiddleware, async (req, res) => {
  try {
    // 로그인한 검토자/승인자와 같은 부대의 사용자만 가져오도록 설정
    const orgId = req.user.unitId || req.user.orgId;
    // status가 'approved'인 부대원만 필터링
    const users = await User.find({ unit: orgId, status: "approved" });

    res.json({ users });
  } catch (error) {
    console.error("부대원 조회 에러:", error);
    res.status(500).json({ error: "부대원 조회 실패" });
  }
});

// 2. [부대원 관리] 승인 대기 중인 인원 불러오기
router.get("/pending-users", authMiddleware, async (req, res) => {
  try {
    const orgId = req.user.unitId || req.user.orgId;
    // status가 'pending'인 가입 대기자만 필터링
    const users = await User.find({ unit: orgId, status: "pending" });

    res.json({ users });
  } catch (error) {
    console.error("대기 인원 조회 에러:", error);
    res.status(500).json({ error: "대기 인원 조회 실패" });
  }
});

// 3. [부대원 관리] 가입 승인 처리
router.post("/approve-user/:id", authMiddleware, async (req, res) => {
  try {
    // ✨ 수정: reviewer(검토자), approver(승인자)만 승인 가능
    if (!["reviewer", "approver"].includes(req.user.role)) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    const user = await User.findById(req.params.id);
    if (!user)
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });

    user.status = "approved"; // 승인 상태로 변경
    await user.save();

    res.json({ success: true, message: "승인 완료" });
  } catch (error) {
    console.error("가입 승인 에러:", error);
    res.status(500).json({ error: "승인 처리 실패" });
  }
});

// 4. [부대원 관리] 가입 거절 처리 (DB에서 삭제)
router.post("/reject-user/:id", authMiddleware, async (req, res) => {
  try {
    // ✨ 수정: reviewer, approver만 거절 가능
    if (!["reviewer", "approver"].includes(req.user.role)) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "거절 및 삭제 완료" });
  } catch (error) {
    console.error("가입 거절 에러:", error);
    res.status(500).json({ error: "거절 처리 실패" });
  }
});

// 5. [부대원 관리] 기존 부대원 삭제 (전역 처리)
router.delete("/members/:id", authMiddleware, async (req, res) => {
  try {
    // ✨ 수정: reviewer, approver만 삭제 가능
    if (!["reviewer", "approver"].includes(req.user.role)) {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "삭제 완료" });
  } catch (error) {
    console.error("부대원 삭제 에러:", error);
    res.status(500).json({ error: "삭제 실패" });
  }
});

// 6. ✨ [부대원 관리] 부대원 권한 변경 (용사 <-> 간부)
router.put("/members/:id/role", authMiddleware, async (req, res) => {
  try {
    // ✨ 수정: reviewer(검토자), approver(승인자)만 권한 변경 가능하도록 수정
    if (!["reviewer", "approver"].includes(req.user.role)) {
      return res
        .status(403)
        .json({
          error: "권한이 없습니다. (검토자 또는 승인자 계정이 필요합니다)",
        });
    }

    const { role, rank } = req.body;
    const member = await User.findById(req.params.id);

    if (!member) {
      return res.status(404).json({ error: "해당 부대원을 찾을 수 없습니다." });
    }

    // 권한 및 직급 업데이트
    member.role = role;
    if (rank) {
      member.rank = rank;
    }

    await member.save();

    res.json({ success: true, message: "권한이 성공적으로 변경되었습니다." });
  } catch (error) {
    console.error("권한 변경 에러:", error);
    res.status(500).json({ error: "권한 변경에 실패했습니다." });
  }
});

module.exports = router;
