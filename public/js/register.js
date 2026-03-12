/**
 * register.js - 부대 및 관리자 등록 로직 (진급/전역일 자동계산 포함)
 */
document.addEventListener("DOMContentLoaded", () => {
  const registerBtn = document.getElementById("registerBtn");
  const goLoginBtn = document.getElementById("goLoginBtn");

  // 기본 입력 요소들
  const password = document.getElementById("password");
  const confirmPassword = document.getElementById("confirmPassword");
  const pwError = document.getElementById("pwError");

  // 🔥 [신규] 인사 관련 DOM 요소
  const isCadreToggle = document.getElementById("isCadre");
  const enlistmentInput = document.getElementById("enlistmentDate");
  const dischargeInput = document.getElementById("dischargeDate");
  const enlistmentLabel = document.getElementById("enlistmentLabel");
  const dischargeLabel = document.getElementById("dischargeLabel");

  /**
   * 1. 간부/용사 스위치 토글 이벤트 (UI 및 필수값 제어)
   */
  if (isCadreToggle) {
    isCadreToggle.addEventListener("change", function () {
      if (this.checked) {
        // 간부 모드
        enlistmentLabel.innerText = "임관일 (선택)";
        dischargeLabel.innerText = "예정 전역일 (선택)";
        dischargeLabel.classList.replace("text-gray-600", "text-primary");
        dischargeInput.value = "";
      } else {
        // 용사 모드
        enlistmentLabel.innerText = "입대일 (필수)";
        dischargeLabel.innerText = "예정 전역일 (자동계산/수정가능)";
        dischargeLabel.classList.replace("text-primary", "text-gray-600");
        calculateDischargeDate();
      }
      validateForm(); // 상태 변경 후 유효성 재검사
    });
  }

  /**
   * 2. 용사 예정 전역일 자동 계산 (+18개월 -1일)
   */
  function calculateDischargeDate() {
    if (!isCadreToggle || isCadreToggle.checked || !enlistmentInput.value)
      return;

    const eDate = new Date(enlistmentInput.value);
    eDate.setMonth(eDate.getMonth() + 18);
    eDate.setDate(eDate.getDate() - 1);

    const yyyy = eDate.getFullYear();
    const mm = String(eDate.getMonth() + 1).padStart(2, "0");
    const dd = String(eDate.getDate()).padStart(2, "0");

    dischargeInput.value = `${yyyy}-${mm}-${dd}`;

    // 시각적 피드백
    dischargeInput.classList.add(
      "ring-2",
      "ring-indigo-400",
      "text-indigo-600",
      "bg-indigo-50"
    );
    setTimeout(
      () =>
        dischargeInput.classList.remove(
          "ring-2",
          "ring-indigo-400",
          "text-indigo-600",
          "bg-indigo-50"
        ),
      800
    );

    validateForm();
  }

  if (enlistmentInput) {
    enlistmentInput.addEventListener("change", calculateDischargeDate);
  }

  /**
   * 3. 실시간 비밀번호 일치 및 폼 전체 유효성 검사
   */
  function validateForm() {
    const isPwMatch =
      password.value === confirmPassword.value && password.value !== "";

    // required 속성이 있는 모든 input을 동적으로 가져와 검사
    const requiredInputs = document.querySelectorAll("input[required]");
    const isAllFilled = Array.from(requiredInputs).every((input) =>
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

    // 날짜 데이터가 필요한지 검사 (간부는 필수가 아님)
    let isDateValid = true;
    if (isCadreToggle && !isCadreToggle.checked) {
      if (!enlistmentInput.value || !dischargeInput.value) isDateValid = false;
    }

    // 모든 조건 충족 시 버튼 활성화
    if (isPwMatch && isAllFilled && isDateValid) {
      registerBtn.classList.remove("btn-disabled");
    } else {
      registerBtn.classList.add("btn-disabled");
    }
  }

  // 모든 입력창에 실시간 검증 이벤트 연결
  document.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", validateForm);
  });

  /**
   * 4. 회원가입 버튼 클릭 이벤트
   */
  registerBtn?.addEventListener("click", async () => {
    // 버튼이 비활성화 상태면 중단
    if (registerBtn.classList.contains("btn-disabled")) return;

    const unitName = document.getElementById("unitName").value.trim();
    const name = document.getElementById("name").value.trim();
    const serviceNumber = document.getElementById("serviceNumber").value.trim();
    const phoneNumber = document.getElementById("phoneNumber").value.trim();
    const pwValue = password.value.trim();

    // 🔥 [신규] 인사 정보 추출
    const enlistmentVal = enlistmentInput ? enlistmentInput.value : null;
    const dischargeVal = dischargeInput ? dischargeInput.value : null;
    const isCadreVal = isCadreToggle ? isCadreToggle.checked : false;

    try {
      toggleLoading(true);

      // 🔥 정확한 API 엔드포인트: /register-unit
      const res = await fetch("/register-unit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitName,
          name,
          serviceNumber,
          phoneNumber,
          password: pwValue,
          enlistmentDate: enlistmentVal,
          dischargeDate: dischargeVal,
          isCadre: isCadreVal, // 백엔드에 간부 여부 전달
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "등록에 실패했습니다.");
        toggleLoading(false);
        return;
      }

      // 성공 시 백엔드에서 보내준 맞춤형 메시지 출력 (예: "간부로 가입되었습니다.")
      alert(data.message || "부대 등록이 완료되었습니다. 로그인 해주세요.");
      window.location.href = "/login.html";
    } catch (err) {
      console.error("Registration Error:", err);
      alert("서버 연결에 실패했습니다.");
      toggleLoading(false);
    }
  });

  /**
   * 5. 기타 이동 버튼
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
