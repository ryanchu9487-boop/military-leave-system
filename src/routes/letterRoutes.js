const express = require("express");
const router = express.Router();
const Letter = require("../../models/Letter");
const { authMiddleware } = require("../middlewares/authMiddleware");

// 1. 讀取信箱資料 (會自動判斷角色) - 此部分維持身分分流邏輯
router.get("/api/letters", authMiddleware, async (req, res) => {
  try {
    const role = req.user.role; 

    if (role === 'Yongsa' || role === 'soldier') {
        return res.json({ success: true, role: role, letters: [] });
    }

    const letters = await Letter.find({ organizationId: req.user.orgId }).sort({ createdAt: -1 });
    res.json({ success: true, role: role, letters });

  } catch (error) {
    console.error("편지 불러오기 오류:", error);
    res.status(500).json({ error: "데이터를 불러오는데 실패했습니다." });
  }
});

// 2. 提交心靈信箱表單 (只限 Yongsa，且加上嚴謹的條件判斷)
router.post("/api/letters", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'Yongsa' && req.user.role !== 'soldier') {
        return res.status(403).json({ error: "용사만 작성할 수 있습니다." });
    }

    const { q1, q2, q3, q4, q5, q6, q7, q8, q9, q10 } = req.body;

    // 🔥 嚴謹防線：如果選 '없다'，強制將細節設為空字串，不論前端傳什麼過來
    await Letter.create({
      organizationId: req.user.orgId,
      q1_absurdity: q1,
      q2_absurdityDetail: q1 === '있다' ? (q2 || "") : "", 
      q3_abuse: q3,
      q4_abuseDetail: q3 === '있다' ? (q4 || "") : "",
      q5_sexual: q5,
      q6_sexualDetail: q5 === '있다' ? (q6 || "") : "",
      q7_money: q7,
      q8_moneyDetail: q7 === '있다' ? (q8 || "") : "",
      q9_praise: q9 || "",
      q10_suggestion: q10 || ""
    });

    res.json({ success: true });
  } catch (error) {
    console.error("마음의 편지 저장 오류:", error);
    res.status(500).json({ error: "편지 제출에 실패했습니다." });
  }
});

// 3. 刪除心靈信箱 (只限 간부, 검토자, 승인자)
router.delete("/api/letters/:id", authMiddleware, async (req, res) => {
  try {
    // 防呆：如果是勇士，絕對不能刪除信件
    if (req.user.role === 'Yongsa' || req.user.role === 'soldier') {
        return res.status(403).json({ error: "삭제 권한이 없습니다." });
    }

    await Letter.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error("편지 삭제 오류:", error);
    res.status(500).json({ error: "편지 삭제에 실패했습니다." });
  }
});

module.exports = router;