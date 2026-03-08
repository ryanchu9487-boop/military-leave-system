const bcrypt = require("bcrypt");
const User = require("../../models/User");

exports.addMember = async (req, res) => {
  try {
    const { serviceNumber, password } = req.body;

    // 1️⃣ 必填檢查
    if (!serviceNumber || !password) {
      return res.status(400).json({
        success: false,
        message: "군번과 비밀번호를 입력하세요.",
      });
    }

    // 2️⃣ 군번으로 사용자 찾기
    const user = await User.findOne({ serviceNumber });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "존재하지 않는 용사입니다.",
      });
    }

    // 3️⃣ 비밀번호 비교 (🔥 중요)
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "비밀번호가 틀렸습니다.",
      });
    }

    // 4️⃣ 이미 다른 부대 소속인지 확인
    if (user.organizationId) {
      return res.json({
        success: false,
        message: "이미 다른 부대에 소속된 인원입니다.",
      });
    }

    // 5️⃣ 현재 관리자 부대로 연결
    user.organizationId = req.user.organizationId;
    await user.save();

    res.json({
      success: true,
      message: "인원 추가 성공!",
    });
  } catch (err) {
    console.error("Add Member Error:", err);
    res.status(500).json({
      success: false,
      message: "서버 오류",
    });
  }
};

exports.deleteMember = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: "해당 사용자를 찾을 수 없습니다." }); // 找不到使用者
    }

    // 驗證：只能刪除同部隊的人員
    if (user.organizationId.toString() !== req.user.orgId.toString()) {
      return res.status(403).json({ error: "권한이 없습니다." }); // 無權限
    }

    // 執行刪除
    await User.deleteOne({ _id: user._id });

    res.json({ success: true, message: "부대원 삭제(전역)가 완료되었습니다." });
  } catch (err) {
    console.error("Delete Member Error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const { role, rank } = req.body;
    const user = await User.findById(req.params.userId);

    // 簡單權限檢查：只有 admin 可以改別人角色
    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    user.role = role || user.role;
    user.rank = rank || user.rank;
    await user.save();

    res.json({
      success: true,
      message: "사용자 권한 및 계급이 변경되었습니다.",
    });
  } catch (err) {
    res.status(500).json({ error: "서버 오류" });
  }
};
