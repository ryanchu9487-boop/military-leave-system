document.addEventListener("DOMContentLoaded", () => {
  const registerBtn = document.getElementById("registerBtn");
  const goLoginBtn = document.getElementById("goLoginBtn");
  const isCadreToggle = document.getElementById("isCadre");
  const enlistmentDateInput = document.getElementById("enlistmentDate");
  const dischargeDateInput = document.getElementById("dischargeDate");

  // ==========================================
  // 1. 跳轉到登入畫面
  // ==========================================
  if (goLoginBtn) {
    goLoginBtn.addEventListener("click", () => {
      window.location.href = "login.html";
    });
  }

  // ==========================================
  // 2. 表單防呆：解除註冊按鈕的 disabled 狀態
  // ==========================================
  // 監聽所有 input，只要密碼有輸入，就解開按鈕封印
  const inputs = document.querySelectorAll("input");
  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      if (registerBtn.classList.contains("btn-disabled")) {
        registerBtn.classList.remove("btn-disabled");
      }
    });
  });

  // ==========================================
  // 3. 自動計算退伍日 (入伍日 + 18個月 - 1天)
  // ==========================================
  if (enlistmentDateInput && dischargeDateInput) {
    enlistmentDateInput.addEventListener("change", (e) => {
      if (!e.target.value) return;
      const enlistDate = new Date(e.target.value);
      
      // 韓國陸軍標準役期約 18 個月
      enlistDate.setMonth(enlistDate.getMonth() + 18);
      enlistDate.setDate(enlistDate.getDate() - 1);
      
      const yyyy = enlistDate.getFullYear();
      const mm = String(enlistDate.getMonth() + 1).padStart(2, "0");
      const dd = String(enlistDate.getDate()).padStart(2, "0");
      
      // 自動填入退伍日欄位 (使用者依然可以手動修改)
      dischargeDateInput.value = `${yyyy}-${mm}-${dd}`;
    });
  }

  // ==========================================
  // 4. 點擊註冊按鈕的完整邏輯
  // ==========================================
  if (registerBtn) {
    registerBtn.addEventListener("click", async () => {
      // 如果按鈕是 disabled 狀態，不執行
      if (registerBtn.classList.contains("btn-disabled")) return;

      // 取得所有輸入框的值
      const unitName = document.getElementById("unitName").value.trim();
      const name = document.getElementById("name").value.trim();
      const serviceNumber = document.getElementById("serviceNumber").value.trim();
      const enlistmentDate = document.getElementById("enlistmentDate").value;
      const dischargeDate = document.getElementById("dischargeDate").value;
      const phoneNumber = document.getElementById("phoneNumber").value.trim();
      const password = document.getElementById("password").value;
      const confirmPassword = document.getElementById("confirmPassword").value;
      const isCadre = document.getElementById("isCadre").checked;

      // (A) 基本防呆檢查
      if (!unitName || !name || !serviceNumber || !phoneNumber || !password) {
        return alert("필수 정보를 모두 입력해주세요. (必填資訊請勿留白)");
      }
      if (!isCadre && (!enlistmentDate || !dischargeDate)) {
        return alert("용사인 경우 입대일과 전역일을 반드시 입력해야 합니다. (勇士必須填寫入伍與退伍日)");
      }
      if (password !== confirmPassword) {
        document.getElementById("pwError").classList.add("peer-invalid:[&:not(:placeholder-shown)]:opacity-100");
        return alert("비밀번호가 일치하지 않습니다. (密碼不一致)");
      }

      // (B) 🔥 決定要呼叫的正確 API 網址 (對齊 authRoutes.js)
      const endpoint = isCadre ? "/register/organization" : "/register/soldier";

      // (C) 準備送給後端的資料包 (統一乾淨版)
      const payload = {
        unitName: unitName,               // 後端現在兩邊都會檢查 unitName！
        name: name,
        rank: isCadre ? "간부" : "용사",   // 給勇士註冊用的階級防呆
        serviceNumber: serviceNumber,
        phoneNumber: phoneNumber,
        password: password,
        enlistmentDate: enlistmentDate || null,
        dischargeDate: dischargeDate || null,
        isCadre: isCadre,                 
        role: isCadre ? "officer" : "soldier"
      };

      try {
        // UI 變化：隱藏按鈕，顯示 Loading 動畫
        document.getElementById("loading").classList.remove("hidden");
        registerBtn.classList.add("hidden");

        // (D) 正式發送 API 請求
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        // (E) 處理後端回傳結果
        if (res.ok && data.success) {
          alert(data.message || "회원가입이 완료되었습니다! 관리자의 승인을 기다려주세요.");
          window.location.href = "login.html"; // 註冊成功，自動跳轉到登入頁
        } else {
          alert(data.error || "회원가입에 실패했습니다.");
        }

      } catch (error) {
        console.error("Registration Error:", error);
        alert("서버 연결에 실패했습니다. (伺服器連線失敗，請確認後端是否運行中)");
      } finally {
        // 不管成功或失敗，最後都要把按鈕恢復原狀
        document.getElementById("loading").classList.add("hidden");
        registerBtn.classList.remove("hidden");
      }
    });
  }
});