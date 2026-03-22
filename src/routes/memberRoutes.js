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
 * 🔥 [終極精準版]：包含權限檢查、既往禁止、防止早於今日，以及防止晚於退伍日！
 */
router.put("/users/:id/promotion-adjust", authMiddleware, async (req, res) => {
  try {
    // A. 權限檢查
    if (!["reviewer", "approver"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: "인사 정보를 수정할 권한이 없습니다." });
    }

    const { targetRank, monthsToAdjust } = req.body;
    const targetUser = await User.findById(req.params.id);
    
    // 取得今天日期並歸零時分秒，確保公平比對
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!targetUser)
      return res.status(404).json({ error: "해당 용사를 찾을 수 없습니다." });
    
    if (targetUser.role !== "soldier")
      return res
        .status(400)
        .json({ error: "간부의 진급일은 조정할 수 없습니다." });

    // B. 取得目前的晉升日期資料與退伍日資料
    let originalDate = null;
    if (targetRank === "상병") originalDate = targetUser.promoToSangbyung;
    if (targetRank === "병장") originalDate = targetUser.promoToByungjang;

    if (!originalDate) {
      return res.status(400).json({ error: "해당 계급의 진급일 정보가 존재하지 않습니다." });
    }

    const dischargeDateObj = new Date(targetUser.dischargeDate);
    dischargeDateObj.setHours(0, 0, 0, 0);

    // C. [防禦 1] 檢查是否已經晉升
    const currentDateObj = new Date(originalDate);
    currentDateObj.setHours(0, 0, 0, 0);
    
    if (currentDateObj <= today) {
      return res.status(400).json({ 
        error: `해당 용사는 이미 ${targetRank} 계급을 달성했거나 진급일이 지났습니다. 이미 지난 일자는 수정할 수 없습니다.` 
      });
    }

    // 計算調整後的日期
    let dateToModify = new Date(originalDate);
    dateToModify.setMonth(dateToModify.getMonth() + monthsToAdjust);
    dateToModify.setHours(0, 0, 0, 0);

    // D. [防禦 2] 預判是否會早於或等於今天 (針對 조기진급)
    if (dateToModify <= today && monthsToAdjust < 0) {
      return res.status(400).json({ 
        error: `조기진급 처리 후의 날짜(${dateToModify.toISOString().split('T')[0]})가 오늘 또는 과거일 수 없습니다. 조정 개월 수를 확인하세요.` 
      });
    }

    // E. [防禦 3] 預判是否會晚於或等於退伍日 (針對 진급누락)
    if (dateToModify >= dischargeDateObj && monthsToAdjust > 0) {
      return res.status(400).json({ 
        error: `진급 누락일(${dateToModify.toISOString().split('T')[0]})이 전역일(${dischargeDateObj.toISOString().split('T')[0]})보다 늦거나 같을 수 없습니다.` 
      });
    }

    // F. 執行日期修改
    if (targetRank === "상병") {
      targetUser.promoToSangbyung = dateToModify;
    } else if (targetRank === "병장") {
      targetUser.promoToByungjang = dateToModify;
    } else {
      return res.status(400).json({ error: "잘못된 진급 조정 요청입니다." });
    }

    // G. 基本日期先後邏輯檢查 (例如上兵不能比一兵快)
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

    // H. 存檔並回傳
    await targetUser.save();

    res.json({
      success: true,
      message: `${targetRank} 진급일이 ${monthsToAdjust > 0 ? '진급누락' : '조기진급'}으로 인해 성공적으로 조정되었습니다.`,
      newRank: getDynamicRank(targetUser),
    });
  } catch (error) {
    console.error("🔥 Promotion Adjust Error:", error);
    res.status(500).json({ error: "진급일 조정 중 서버 오류가 발생했습니다." });
  }
});

// =========================================================================
// 🔥 [新增] 3. 刪除人員 (退伍處理) API
// =========================================================================
router.delete("/members/:id", authMiddleware, async (req, res) => {
  try {
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

    if (typeof Leave !== "undefined") {
      await Leave.deleteMany({ userId: targetUserId });
    }

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
    if (!["reviewer", "approver", "admin", "superadmin"].includes(req.user.role)) {
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

    if (role === "officer") {
      role = "reviewer";
    }

    let updateData = { role: role, rank: rank };

    if (role === "soldier" && targetUser.enlistmentDate) {
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
      updateData.promoToIlbyung = null;
      updateData.promoToSangbyung = null;
      updateData.promoToByungjang = null;
    }

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