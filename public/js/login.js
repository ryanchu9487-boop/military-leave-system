/**
 * 로그인 페이지 전용 로직
 */
document.addEventListener("DOMContentLoaded", () => {
  // 1. 요소 초기화
  const loginBtn = document.getElementById("loginBtn");
  const passwordInput = document.getElementById("password");
  const serviceNumberInput = document.getElementById("serviceNumber");
  const registerBtn = document.getElementById("registerBtn");
  const errorBox = document.getElementById("errorBox");

  // 2. 이벤트 바인딩
  loginBtn?.addEventListener("click", handleLogin);

  passwordInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLogin();
  });

  // 🔥 사용자가 다시 입력하기 시작하면 에러 박스 숨기기
  const hideError = () => {
    if (errorBox) errorBox.classList.add("hidden");
  };
  passwordInput?.addEventListener("input", hideError);
  serviceNumberInput?.addEventListener("input", hideError);

  registerBtn?.addEventListener("click", () => {
    window.location.href = "/register.html";
  });

  // (비밀번호 재설정은 HTML의 onclick="openForgotModal()"로 처리됨)

  // 3. 페이지 로드 시 자동 로그인 확인
  checkAutoLogin();
});

/**
 * 로그인 처리 메인 함수
 */
async function handleLogin() {
  const serviceNumber = document.getElementById("serviceNumber").value.trim();
  const password = document.getElementById("password").value.trim();
  const errorBox = document.getElementById("errorBox");
  const errorText = document.getElementById("errorText");

  // 유효성 검사 (프론트엔드 1차 방어)
  if (!serviceNumber || !password)
    return showError("군번과 비밀번호를 모두 입력해 주세요.");
  if (!/^\d{2}-\d{8}$/.test(serviceNumber))
    return showError("군번 형식(XX-XXXXXXXX)이 올바르지 않습니다.");

  try {
    toggleLoading(true);

    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceNumber, password }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      // 🔥 서버가 보내준 똑똑한 에러 메시지(남은 횟수 등)를 그대로 출력!
      const errorMessage =
        data.message || data.error || "로그인에 실패했습니다.";
      showError(errorMessage);
      toggleLoading(false);
      return;
    }

    // 로그인 성공: 에러 박스 숨김 및 토큰 저장
    if (errorBox) errorBox.classList.add("hidden");
    localStorage.setItem("token", data.token);

    if (data.user && data.user.role) {
      localStorage.setItem("role", data.user.role);
    }

    // 🔥 [강제 변경 방어막 1] 간부가 비밀번호를 초기화해줬다면 무조건 설정 페이지로 납치!
    if (data.user && data.user.forceChangePassword) {
      alert("보안을 위해 비밀번호를 반드시 변경해야 합니다.");
      window.location.href = "settings.html";
      return; // 여기서 함수 종료 (아래로 넘어가지 못함)
    }

    // 일반적인 경우: 유저 정보 한 번 더 확인 후 달력 페이지 리다이렉트
    await fetchProfileAndRedirect(data.token);
  } catch (err) {
    console.error("Login Error:", err);
    showError("서버와 통신 중 오류가 발생했습니다.");
    toggleLoading(false);
  }
}

/**
 * 🔥 에러 메시지를 화면에 예쁘게 띄워주는 헬퍼 함수
 */
function showError(message) {
  const errorBox = document.getElementById("errorBox");
  const errorText = document.getElementById("errorText");

  if (errorBox && errorText) {
    errorText.innerText = message;
    errorBox.classList.remove("hidden");
    // 흔들림 애니메이션 효과 (UX 향상)
    errorBox.classList.remove("shake-anim");
    void errorBox.offsetWidth; // 리플로우 강제 발생 (애니메이션 재시작 트릭)
    errorBox.classList.add("shake-anim");
  } else {
    alert(message); // 만약 HTML에 에러박스가 없다면 기본 alert로 폴백
  }
}

/**
 * 프로필 조회 및 통합 페이지 리다이렉트
 */
async function fetchProfileAndRedirect(token) {
  try {
    const res = await fetch("/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (data.user) {
      localStorage.setItem("role", data.user.role);

      // 🔥 [강제 변경 방어막 2] 우회 접근을 막기 위한 이중 체크
      if (data.user.forceChangePassword) {
        alert("보안을 위해 비밀번호를 반드시 변경해야 합니다.");
        window.location.href = "settings.html";
      } else {
        window.location.href = "index.html";
      }
    } else {
      throw new Error("Invalid User Data");
    }
  } catch (err) {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    showError(`사용자 정보를 가져오는 데 실패했습니다: ${err.message}`);
    toggleLoading(false);
  }
}

/**
 * 자동 로그인 확인
 */
async function checkAutoLogin() {
  const token = localStorage.getItem("token");
  if (!token) return;

  try {
    const res = await fetch("/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (data.user) {
      localStorage.setItem("role", data.user.role);

      // 🔥 [강제 변경 방어막 3] 자동 로그인 시에도 변경이 필요하면 설정 창으로!
      if (data.user.forceChangePassword) {
        window.location.href = "settings.html";
      } else {
        window.location.href = "index.html";
      }
    }
  } catch (err) {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
  }
}

/**
 * UI 로딩 상태 제어
 */
function toggleLoading(isLoading) {
  const btn = document.getElementById("loginBtn");
  const loader = document.getElementById("loading");

  if (btn) btn.style.display = isLoading ? "none" : "block";
  if (loader) loader.classList.toggle("hidden", !isLoading);
}
