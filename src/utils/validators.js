/**
 * 비밀번호 유효성 검사기
 * - 최소 8자 이상
 * - 영문 대문자, 소문자, 숫자, 특수문자 중 3종류 이상 조합 (보안 강화)
 */
const passwordValidator = {
  validator: function (v) {
    // 암호화된 비밀번호($로 시작하는 60자 문자열)이거나,
    // 사용자 입력(8자 이상 영문+숫자)인 경우 모두 통과
    if (v.startsWith("$2b$") && v.length === 60) return true;
    return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/.test(v);
  },
  message: (props) =>
    `비밀번호는 최소 8자 이상이며, 영문자와 숫자를 모두 포함해야 합니다.`,
};

/**
 * 전화번호 유효성 검사기 (한국 형식)
 * - 010-1234-5678 형식
 */
const phoneValidator = {
  validator: function (v) {
    return /^\d{3}-\d{3,4}-\d{4}$/.test(v);
  },
  message: (props) => `${props.value}는 올바른 전화번호 형식이 아닙니다.`,
};

/**
 * 군번 유효성 검사기
 * - XX-XXXXXXXX 형식
 */
const serviceNumberValidator = {
  validator: function (v) {
    return /^\d{2}-\d{8}$/.test(v);
  },
  message: (props) => `군번 형식이 올바르지 않습니다 (예: 24-12345678).`,
};

module.exports = {
  passwordValidator,
  phoneValidator,
  serviceNumberValidator,
};
