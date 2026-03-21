// public/common.js

const roleMap = {
  soldier: "용사",
  officer: "간부",
  reviewer: "검토자",
  approver: "승인자",
};

// ==========================================
// 🚀 SmartMil 終極 SPA 導航引擎 (暴力破解腳本快取版)
// ==========================================
window.spaNavigate = async function (urlPath) {
  const url = new URL(urlPath, window.location.origin).href;
  if (typeof closeSidebar === "function") closeSidebar();

  const wrapper = document.getElementById("page-wrapper");
  if (!wrapper) {
    window.location.href = url;
    return;
  }

  wrapper.style.transition = "opacity 0.2s ease";
  wrapper.style.opacity = "0.3";

  try {
    // 1. 強制抓取最新的 HTML
    const fetchUrl = url + (url.includes('?') ? '&' : '?') + 't=' + new Date().getTime();
    const res = await fetch(fetchUrl, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    document.title = doc.title;
    document.body.className = doc.body.className;

    // 2. 同步 CSS
    document.querySelectorAll("style:not([id])").forEach(s => s.remove());
    doc.querySelectorAll("style:not([id])").forEach(s => {
      const newStyle = document.createElement("style");
      newStyle.textContent = s.textContent;
      document.head.appendChild(newStyle);
    });

    const newContent = doc.getElementById("page-wrapper");
    if (newContent) {
      wrapper.innerHTML = newContent.innerHTML;

      // 🔥 3. 核心修復：拔除所有的「防重複檢查」
      // 直接讓瀏覽器把 adduser.js 當作全新的檔案強制重新載入並執行！
      const scripts = Array.from(newContent.querySelectorAll("script"));
      for (const oldScript of scripts) {
        if (oldScript.src && oldScript.src.includes("common.js")) continue;

        await new Promise((resolve) => {
          const newScript = document.createElement("script");
          if (oldScript.src) {
            // 加上時間戳，強迫瀏覽器忘記舊快取，重新執行腳本！
            newScript.src = oldScript.src + "?t=" + new Date().getTime(); 
            newScript.onload = resolve;
            newScript.onerror = resolve;
            document.body.appendChild(newScript);
          } else {
            newScript.textContent = oldScript.textContent;
            document.body.appendChild(newScript);
            newScript.remove();
            resolve();
          }
        });
      }
    }

    history.pushState(null, "", url);

    // 4. 喚醒畫面
    setTimeout(() => {
      wrapper.style.opacity = "1";
      reInitializePage();
    }, 50);

  } catch (err) {
    console.error("SPA 導航失敗:", err);
    window.location.href = url;
  }
};

// ==========================================
// 🚀 簡單粗暴的喚醒機制
// ==========================================
function reInitializePage() {
  applyRolePermissions(); 
  
  const path = window.location.pathname.toLowerCase();
  
  // 既然腳本已經被我們「強制重新執行」了，我們直接呼叫對應的大腦就好！
  setTimeout(() => {
    if (path.includes("adduser")) {
       console.log("✅ 啟動人員管理...");
       if (typeof window.fetchUsers === "function") window.fetchUsers();
    } else if (path.includes("settings")) {
       console.log("✅ 啟動設定頁...");
       if (typeof window.loadSettingsPage === "function") window.loadSettingsPage();
    } else {
       console.log("✅ 啟動月曆...");
       if (typeof window.initCalendarPage === "function") window.initCalendarPage();
    }
  }, 150);
}

// ==========================================
// 🔔 權限與小鈴鐺共用邏輯
// ==========================================
function openSidebar() {
  document.getElementById("sidebar")?.classList.remove("-translate-x-full");
}

function closeSidebar() {
  document.getElementById("sidebar")?.classList.add("-translate-x-full");
}

// 🔥 修復關鍵：把原本被我誤刪的 UI 解除隱藏邏輯加回來
function applyRolePermissions() {
  const userRole = localStorage.getItem("role");
  
  const sidebarManageBtn = document.getElementById("manageTeamSidebarBtn");
  const calToggle = document.getElementById("calendarToggle");
  const notifWrapper = document.getElementById("notificationWrapper");
  const fabGrantBtn = document.getElementById("fabGrantBtn");

  // 解除隱藏月曆頂部控制列 (包含齒輪按鈕)
  if (calToggle) calToggle.style.setProperty("display", "flex", "important");
  
  // 解除隱藏小鈴鐺與出島申請按鈕
  if (notifWrapper) notifWrapper.style.display = "flex";
  if (fabGrantBtn) fabGrantBtn.style.setProperty("display", "flex", "important");
  
  // 側邊欄「人員管理」僅限長官顯示
  if (["reviewer", "approver", "superadmin"].includes(userRole)) {
    if (sidebarManageBtn) sidebarManageBtn.style.setProperty("display", "flex", "important");
  } else {
    if (sidebarManageBtn) sidebarManageBtn.style.setProperty("display", "none", "important");
  }

  checkPendingLeaves();
}

async function checkPendingLeaves() {
  const token = localStorage.getItem("token");
  if (!token) return;

  try {
    const res = await fetch("/profile", { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.user) {
      const u = data.user;
      localStorage.setItem("role", u.role);
      
     // 🔥 關鍵修復：優先顯示「階級 (u.rank)」，如果沒有才顯示「角色 (u.role)」
      const displayRank = u.rank ? u.rank : (roleMap[u.role] || u.role);
      const nameEl = document.getElementById("user-profile-name");
      if (nameEl) nameEl.innerText = `${u.name} (${displayRank})`;
      
      const initEl = document.getElementById("headerProfileInitials");
      if (initEl) initEl.innerText = u.name.charAt(0);
    }
  } catch (e) {
    console.error("Header 資料抓取失敗");
  }
}

function logout() {
  if (confirm("로그아웃 하시겠습니까?")) {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  }
}

// 攔截點擊事件，實作 SPA 跳轉
document.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (link && link.href && link.href.startsWith(window.location.origin) && !link.hasAttribute("target")) {
    if (link.href.includes("logout") || link.onclick?.toString().includes("logout")) return;
    
    e.preventDefault();
    spaNavigate(link.href);
  }
});

// 處理瀏覽器返回鍵
window.addEventListener("popstate", () => {
  window.location.reload();
});
// 初始載入
document.addEventListener("DOMContentLoaded", applyRolePermissions);