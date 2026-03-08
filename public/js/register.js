/**
 * register.js - 부대 및 관리자 등록 로직
 */
document.addEventListener("DOMContentLoaded", () => {
  const registerBtn = document.getElementById("registerBtn");
  const goLoginBtn = document.getElementById("goLoginBtn");

  // 입력 요소들
  const password = document.getElementById("password");
  const confirmPassword = document.getElementById("confirmPassword");
  const pwError = document.getElementById("pwError");
  const inputs = document.querySelectorAll("input[required]");

  /**
   * 1. 실시간 비밀번호 일치 및 유효성 검사
   */
  function validateForm() {
    const isPwMatch =
      password.value === confirmPassword.value && password.value !== "";
    const isAllFilled = Array.from(inputs).every((input) =>
      input.checkValidity()
    );

    // 비밀번호 확인 칸 스타일 및 에러 메시지 제어
    if (confirmPassword.value.length > 0) {
      if (!isPwMatch) {
        confirmPassword.classList.add("border-error");
        confirmPassword.classList.remove("border-success");
        pwError.classList.replace("opacity-0", "opacity-100");
        pwError.classList.replace("scale-95", "scale-100");
      } else {
        confirmPassword.classList.remove("border-error");
        confirmPassword.classList.add("border-success");
        pwError.classList.replace("opacity-100", "opacity-0");
        pwError.classList.replace("scale-100", "scale-95");
      }
    }

    // 모든 조건 충족 시 버튼 활성화
    if (isPwMatch && isAllFilled) {
      registerBtn.classList.remove("btn-disabled");
    } else {
      registerBtn.classList.add("btn-disabled");
    }
  }

  // 모든 입력창에 실시간 검증 이벤트 연결
  inputs.forEach((input) => {
    input.addEventListener("input", validateForm);
  });

  /**
   * 2. 회원가입 버튼 클릭 이벤트
   */
  registerBtn?.addEventListener("click", async () => {
    // 버튼이 비활성화 상태면 중단
    if (registerBtn.classList.contains("btn-disabled")) return;

    const unitName = document.getElementById("unitName").value.trim();
    const name = document.getElementById("name").value.trim();
    const serviceNumber = document.getElementById("serviceNumber").value.trim();
    const phoneNumber = document.getElementById("phoneNumber").value.trim();
    const pwValue = password.value.trim();

    try {
      toggleLoading(true);

      const res = await fetch("/register-unit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitName,
          name,
          serviceNumber,
          phoneNumber,
          password: pwValue,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "등록에 실패했습니다.");
        toggleLoading(false);
        return;
      }

      alert("부대 등록이 완료되었습니다. 로그인 해주세요.");
      window.location.href = "/login.html";
    } catch (err) {
      console.error("Registration Error:", err);
      alert("서버 연결에 실패했습니다.");
      toggleLoading(false);
    }
  });

  /**
   * 3. 기타 이동 버튼
   */
  goLoginBtn?.addEventListener("click", () => {
    window.location.href = "/login.html";
  });
});

/**
 * UI 로딩 상태 토글 함수
 */
function toggleLoading(isLoading) {
  const btn = document.getElementById("registerBtn");
  const loader = document.getElementById("loading");

  if (isLoading) {
    btn.classList.add("hidden");
    loader?.classList.remove("hidden");
  } else {
    btn.classList.remove("hidden");
    loader?.classList.add("hidden");
  }
}
