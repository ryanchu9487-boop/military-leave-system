/**
 * 로그인 페이지 전용 로직
 */
document.addEventListener("DOMContentLoaded", () => {
  // 1. 요소 초기화
  const loginBtn = document.getElementById("loginBtn");
  const passwordInput = document.getElementById("password");
  const registerBtn = document.getElementById("registerBtn");
  const forgotBtn = document.getElementById("forgotBtn");

  // 2. 이벤트 바인딩
  loginBtn?.addEventListener("click", handleLogin);

  passwordInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLogin();
  });

  registerBtn?.addEventListener("click", () => {
    window.location.href = "/register.html";
  });

  forgotBtn?.addEventListener("click", () => {
    window.location.href = "/forgot-password.html";
  });

  // 3. 페이지 로드 시 자동 로그인 확인
  checkAutoLogin();
});

/**
 * 로그인 처리 메인 함수
 */
async function handleLogin() {
  const serviceNumber = document.getElementById("serviceNumber").value.trim();
  const password = document.getElementById("password").value.trim();

  // 유효성 검사 (프론트엔드 1차 방어)
  if (!serviceNumber || !password)
    return alert("군번과 비밀번호를 모두 입력해 주세요.");
  if (!/^\d{2}-\d{8}$/.test(serviceNumber))
    return alert("군번 형식(XX-XXXXXXXX)이 올바르지 않습니다.");

  try {
    toggleLoading(true);

    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceNumber, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      // 1. 서버가 보내준 구체적인 에러 메시지 추출
      const errorMessage =
        data.message ||
        data.error ||
        (data.errors ? Object.values(data.errors).join(", ") : null);

      // 2. HTTP 상태 코드별 기본 메시지 설정 (Fallback)
      let finalMessage = errorMessage;
      if (!finalMessage) {
        if (res.status === 401)
          finalMessage = "군번 또는 비밀번호가 일치하지 않습니다.";
        else if (res.status === 403)
          finalMessage = "접근 권한이 없거나 계정이 잠겨 있습니다.";
        else if (res.status === 429)
          finalMessage =
            "너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.";
        else if (res.status === 500)
          finalMessage =
            "서버 내부 오류가 발생했습니다. 관리자에게 문의하세요.";
        else finalMessage = "알 수 없는 오류가 발생했습니다.";
      }

      // 3. 사용자에게 알림
      console.error(`[Login Error ${res.status}]:`, data);
      alert(`❌ 로그인 실패\n\n이유: ${finalMessage}`);

      toggleLoading(false);
      return;
    }

    // 로그인 성공: 토큰과 역할을 로컬 스토리지에 저장
    localStorage.setItem("token", data.token);

    // 🔥 백엔드 응답에 user 정보와 role이 있다면 바로 저장
    if (data.user && data.user.role) {
      localStorage.setItem("role", data.user.role);
    }

    // 유저 정보 한 번 더 확인 후 리다이렉트
    await fetchProfileAndRedirect(data.token);
  } catch (err) {
    console.error("Login Error:", err);
    alert("서버와 통신 중 오류가 발생했습니다.");
    toggleLoading(false);
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
      // 🔥 index.html에서 권한 제어(applyRolePermissions)를 할 수 있도록 role 저장
      localStorage.setItem("role", data.user.role);

      // 🔥 모든 신분(용사, 간부, 검토자, 승인자)은 통합된 index.html로 이동
      window.location.href = "/index.html";
    } else {
      throw new Error("Invalid User Data");
    }
  } catch (err) {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    alert(`사용자 정보를 가져오는 데 실패했습니다: ${err.message}`);
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
      // 🔥 자동 로그인 시에도 role 업데이트 및 index.html로 이동
      localStorage.setItem("role", data.user.role);
      window.location.href = "/index.html";
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
