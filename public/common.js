// public/common.js
const roleMap = { soldier: "용사", officer: "간부", reviewer: "검토자", approver: "승인자" };

// public/common.js 中的 spaNavigate 升級

window.spaNavigate = async function (urlPath) {
  const url = new URL(urlPath, window.location.origin).href;
  closeSidebar();
  
  const currentWrapper = document.getElementById("page-wrapper");
  if (!currentWrapper) { window.location.href = url; return; }

  // 1. 🔥 [防舊資料閃現] 先將舊內容隱藏或清空關鍵區域
  currentWrapper.style.opacity = "0"; 

  try {
    const res = await fetch(url);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    // 2. 同步標題與 Body
    document.title = doc.title;
    document.body.className = doc.body.className;

    // 3. 🔥 [徹底更換] 直接替換 innerHTML
    currentWrapper.innerHTML = doc.getElementById("page-wrapper").innerHTML;

    // 4. 🔥 [重要] 將新頁面的 script 內容提取並重新執行
    // 這解決了「不會自動叫醒新頁面 JS」的問題
    const scripts = doc.querySelectorAll("#page-wrapper script, main + script, body > script:not([src*='common.js'])");
    scripts.forEach(oldScript => {
      const newScript = document.createElement("script");
      if (oldScript.src) {
        newScript.src = oldScript.src;
      } else {
        newScript.textContent = oldScript.textContent;
      }
      document.body.appendChild(newScript);
      // 執行完後移除，避免 DOM 堆積
      if (!oldScript.src) newScript.remove(); 
    });

    // 5. 更新 URL
    history.pushState(null, "", url);

    // 6. 🔥 [強力喚醒] 顯示新畫面並觸發初始化
    setTimeout(() => {
      currentWrapper.style.opacity = "1";
      reInitializePage(urlPath);
    }, 50);

  } catch (err) {
    console.error("導航失敗，執行傳統跳轉", err);
    window.location.href = url;
  }
};

// 修正 reInitializePage，確保每個函數都被確實執行
function reInitializePage(path) {
  applyRolePermissions(); 

  // 延遲 100ms 確保 DOM 已完全渲染
  setTimeout(() => {
    if (path === "/" || path.includes("index")) {
      if (typeof initApp === "function") initApp();
    } 
    else if (path.includes("adduser")) {
      // 喚醒 adduser.js 中的初始化
      if (typeof fetchUsers === "function") fetchUsers();
      if (typeof fetchUserInfoAndNotifications === "function") fetchUserInfoAndNotifications();
    } 
    else if (path.includes("settings")) {
      // 🔥 叫醒您剛剛補回來的 loadSettingsPage
      if (typeof window.loadSettingsPage === "function") {
        window.loadSettingsPage();
      }
    }
  }, 100);
}

// --- 🔔 共用邏輯 ---
function openSidebar() {
  document.getElementById("sidebar")?.classList.remove("-translate-x-full");
  document.getElementById("sidebarOverlay")?.classList.remove("hidden", "opacity-0");
  document.getElementById("sidebarOverlay")?.classList.add("opacity-100");
}

function closeSidebar() {
  document.getElementById("sidebar")?.classList.add("-translate-x-full");
  document.getElementById("sidebarOverlay")?.classList.remove("opacity-100");
  document.getElementById("sidebarOverlay")?.classList.add("opacity-0");
  setTimeout(() => document.getElementById("sidebarOverlay")?.classList.add("hidden"), 300);
}

function applyRolePermissions() {
  const userRole = localStorage.getItem("role");
  // 顯示對應按鈕
  const sidebarManageBtn = document.getElementById("manageTeamSidebarBtn");
  if (["reviewer", "approver", "superadmin"].includes(userRole)) {
    sidebarManageBtn?.style.setProperty("display", "flex", "important");
  }
  // 執行撈取小鈴鐺與使用者名稱
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
      localStorage.setItem("role", u.role); // 確保角色正確
      const nameEl = document.getElementById("user-profile-name");
      if (nameEl) nameEl.innerText = `${u.name} (${roleMap[u.role] || u.role})`;
      const initEl = document.getElementById("headerProfileInitials");
      if (initEl) initEl.innerText = u.name.charAt(0);
    }
    // 這裡繼續執行您原本的小鈴鐺 fetch 邏輯...
  } catch (e) {}
}

function logout() { if (confirm("로그아웃 하시겠습니까?")) { localStorage.removeItem("token"); window.location.href = "/login.html"; } }

document.addEventListener("DOMContentLoaded", applyRolePermissions);