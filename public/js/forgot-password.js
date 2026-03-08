/**
 * 비밀번호 초기화 요청 처리 스크립트
 */
document.addEventListener("DOMContentLoaded", () => {
  const resetForm = document.getElementById("resetRequestForm");
  const messageEl = document.getElementById("message");
  const sendBtn = document.getElementById("sendBtn");

  // UI 상태 업데이트 함수
  const updateMessage = (text, isSuccess = false) => {
    messageEl.textContent = text;
    messageEl.className = isSuccess
      ? "mt-4 text-sm text-center text-green-600 font-medium"
      : "mt-4 text-sm text-center text-red-500";
  };

  // 폼 제출 이벤트 리스너
  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault(); // 기본 폼 제출 방지

    const serviceNumber = document.getElementById("serviceNumber").value.trim();
    const name = document.getElementById("name").value.trim();

    // 1. 기본 유효성 검사
    if (!serviceNumber || !name) {
      updateMessage("모든 항목을 입력해주세요.");
      return;
    }

    // 2. 버튼 비활성화 (중복 클릭 방지)
    sendBtn.disabled = true;
    sendBtn.textContent = "처리 중...";
    updateMessage("요청을 전송하고 있습니다...", true);

    try {
      // 3. API 호출
      const response = await fetch("/request-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceNumber, name }),
      });

      const data = await response.json();

      if (response.ok) {
        // 성공 시
        updateMessage("요청 완료! 부대 관리자가 승인 후 초기화됩니다.", true);
        resetForm.reset(); // 입력창 비우기
      } else {
        // 서버 에러 메시지 처리
        updateMessage(data.message || "정보가 일치하지 않습니다.");
      }
    } catch (err) {
      console.error("Fetch Error:", err);
      updateMessage("서버와의 통신에 실패했습니다. 네트워크를 확인하세요.");
    } finally {
      // 4. 버튼 복구
      sendBtn.disabled = false;
      sendBtn.textContent = "초기화 요청 보내기";
    }
  });
});
