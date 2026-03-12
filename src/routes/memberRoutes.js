const express = require("express");
const router = express.Router();
const User = require("../../models/User");
const Leave = require("../../models/Leave"); // 確保這裡有引入 Leave 模型
const { authMiddleware } = require("../middlewares/authMiddleware");

/**
 * 🔥 [核心神技] 動態計算真實階級
 * 根據今天的日期，比對使用者的晉升基準日，動態回傳正確階級
 */
function getDynamicRank(user) {
  if (user.role !== "soldier" || !user.enlistmentDate) {
    return user.rank || "계급없음";
  }

  const today = new Date();

  if (user.promoToByungjang && today >= user.promoToByungjang) return "병장";
  if (user.promoToSangbyung && today >= user.promoToSangbyung) return "상병";
  if (user.promoToIlbyung && today >= user.promoToIlbyung) return "일병";

  return "이병";
}

/**
 * 1. 取得所屬部隊的所有人員名單 (包含動態階級與晉升日)
 */
router.get("/users/org-members", authMiddleware, async (req, res) => {
  try {
    const { orgId } = req.user;
    const users = await User.find({
      organizationId: orgId,
      status: "approved",
    }).lean();

    const membersWithDynamicRank = users.map((u) => ({
      ...u,
      currentRank: getDynamicRank(u),
    }));

    res.json({ success: true, members: membersWithDynamicRank });
  } catch (error) {
    res.status(500).json({ error: "부대원 목록을 불러오는데 실패했습니다." });
  }
});

/**
 * 2. 晉升日手動微調 API (조기진급 / 진급누락)
 */
router.put("/users/:id/promotion-adjust", authMiddleware, async (req, res) => {
  try {
    if (!["reviewer", "approver"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: "인사 정보를 수정할 권한이 없습니다." });
    }

    const { targetRank, monthsToAdjust } = req.body;
    const targetUser = await User.findById(req.params.id);

    if (!targetUser)
      return res.status(404).json({ error: "해당 용사를 찾을 수 없습니다." });
    if (targetUser.role !== "soldier")
      return res
        .status(400)
        .json({ error: "간부의 진급일은 조정할 수 없습니다." });

    let dateToModify = null;

    if (targetRank === "상병" && targetUser.promoToSangbyung) {
      dateToModify = new Date(targetUser.promoToSangbyung);
      dateToModify.setMonth(dateToModify.getMonth() + monthsToAdjust);
      targetUser.promoToSangbyung = dateToModify;
    } else if (targetRank === "병장" && targetUser.promoToByungjang) {
      dateToModify = new Date(targetUser.promoToByungjang);
      dateToModify.setMonth(dateToModify.getMonth() + monthsToAdjust);
      targetUser.promoToByungjang = dateToModify;
    } else {
      return res.status(400).json({ error: "잘못된 진급 조정 요청입니다." });
    }

    if (targetUser.promoToSangbyung <= targetUser.promoToIlbyung) {
      return res
        .status(400)
        .json({ error: "상병 진급일이 일병 진급일보다 빠를 수 없습니다." });
    }
    if (targetUser.promoToByungjang <= targetUser.promoToSangbyung) {
      return res
        .status(400)
        .json({ error: "병장 진급일이 상병 진급일보다 빠를 수 없습니다." });
    }

    await targetUser.save();

    res.json({
      success: true,
      message: `${targetRank} 진급일이 성공적으로 조정되었습니다.`,
      newRank: getDynamicRank(targetUser),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "진급일 조정 중 서버 오류가 발생했습니다." });
  }
});

// =========================================================================
// 🔥 [新增] 3. 刪除人員 (退伍處理) API
// =========================================================================
router.delete("/members/:id", authMiddleware, async (req, res) => {
  try {
    // 只有幹部可以刪除
    if (
      !["reviewer", "approver", "admin", "superadmin"].includes(req.user.role)
    ) {
      return res.status(403).json({ error: "삭제 권한이 없습니다." });
    }

    const targetUserId = req.params.id;
    const targetUser = await User.findById(targetUserId);

    if (!targetUser) {
      return res.status(404).json({ error: "해당 인원을 찾을 수 없습니다." });
    }

    // 🧹 為了保持資料庫乾淨，刪除人員前，連帶把他的「所有休假紀錄」一併刪除！
    if (typeof Leave !== "undefined") {
      await Leave.deleteMany({ userId: targetUserId });
    }

    // 刪除使用者
    await User.findByIdAndDelete(targetUserId);

    res.json({
      success: true,
      message: "성공적으로 전역/삭제 처리되었습니다.",
    });
  } catch (error) {
    console.error("🔥 전역 처리 오류:", error);
    res.status(500).json({ error: "서버 내부 오류로 삭제하지 못했습니다." });
  }
});

// =========================================================================
// 🔥 [終極版] 4. 變更權限 API (勇士 <-> 幹部 切換，包含日期與權限洗牌)
// =========================================================================
router.put("/members/:id/role", authMiddleware, async (req, res) => {
  try {
    // 只有最高批准者或管理員可以更改別人的權限
    if (!["approver", "admin", "superadmin"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: "권한을 변경할 수 있는 자격이 없습니다." });
    }

    let { role, rank } = req.body;
    const targetUserId = req.params.id;

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    // 🌟 [神級防呆 1] 權限映射：
    // 前端選單傳來的是 "officer" (一般幹部)，我們在後端自動將他賦予 "reviewer" (檢核者) 的權限
    // 這樣他一登入就能看到小鈴鐺，也能立刻開始批准假單！
    if (role === "officer") {
      role = "reviewer";
    }

    let updateData = { role: role, rank: rank };

    // 🌟 [神級防呆 2] 日期與時間軸重置：
    if (role === "soldier" && targetUser.enlistmentDate) {
      // 【幹部 -> 勇士】：自動幫他把失去的 18 個月退伍日和所有晉升日「重新算回來」
      const eDate = new Date(targetUser.enlistmentDate);

      const dDate = new Date(eDate);
      dDate.setMonth(dDate.getMonth() + 18);
      dDate.setDate(dDate.getDate() - 1);

      const getPromoDate = (months) => {
        const pDate = new Date(eDate);
        pDate.setMonth(pDate.getMonth() + months);
        pDate.setDate(1);
        return pDate;
      };

      updateData.dischargeDate = dDate;
      updateData.promoToIlbyung = getPromoDate(3);
      updateData.promoToSangbyung = getPromoDate(9);
      updateData.promoToByungjang = getPromoDate(15);
    } else if (role !== "soldier") {
      // 【勇士 -> 幹部】：無情抹除他的晉升紀錄，因為長官不需要升上兵或兵長
      // 退伍日保留讓他自己手動改，或者維持現狀
      updateData.promoToIlbyung = null;
      updateData.promoToSangbyung = null;
      updateData.promoToByungjang = null;
    }

    // 執行更新
    await User.findByIdAndUpdate(targetUserId, updateData, { new: true });

    res.json({
      success: true,
      message: "권한과 인사 정보가 성공적으로 변경되었습니다.",
    });
  } catch (error) {
    console.error("🔥 권한 변경 오류:", error);
    res.status(500).json({ error: "권한 변경 중 서버 오류가 발생했습니다." });
  }
});

module.exports = router;
