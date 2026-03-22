// public/common.js

const roleMap = {
  soldier: "용사",
  officer: "간부",
  reviewer: "검토자",
  approver: "승인자",
};

// ==========================================
// 🚀 SmartMil 終極 SPA 導航引擎 (完美順序修復版)
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
    const fetchUrl = url + (url.includes('?') ? '&' : '?') + 't=' + new Date().getTime();
    const res = await fetch(fetchUrl, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    document.title = doc.title;
    document.body.className = doc.body.className;

    const currentStyles = Array.from(document.querySelectorAll("style:not([id])")).map(s => s.textContent.trim());
    
    doc.querySelectorAll("style:not([id])").forEach(s => {
      if (!currentStyles.includes(s.textContent.trim())) {
        const newStyle = document.createElement("style");
        newStyle.textContent = s.textContent;
        document.head.appendChild(newStyle);
      }
    });

    history.pushState(null, "", url);

    const newContent = doc.getElementById("page-wrapper");
    if (newContent) {
      wrapper.className = newContent.className;
      wrapper.innerHTML = newContent.innerHTML;

      const scripts = Array.from(newContent.querySelectorAll("script"));
      for (const oldScript of scripts) {
        if (oldScript.src && oldScript.src.includes("common.js")) continue;

        await new Promise((resolve) => {
          const newScript = document.createElement("script");
          if (oldScript.src) {
            newScript.src = oldScript.src + "?t=" + new Date().getTime(); 
            newScript.onload = () => { resolve(); newScript.remove(); };
            newScript.onerror = () => { resolve(); newScript.remove(); };
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
  
  setTimeout(() => {
    if (path.includes("adduser")) {
       if (typeof window.fetchUsers === "function") window.fetchUsers();
    } else if (path.includes("settings")) {
       if (typeof window.loadSettingsPage === "function") window.loadSettingsPage();
    } else if (path.includes("review")) { 
       if (typeof window.initReviewPage === "function") window.initReviewPage();
    } else if (path.includes("approve")) {
       if (typeof window.initApprovePage === "function") window.initApprovePage(); 
    } else {
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

function applyRolePermissions() {
  const userRole = localStorage.getItem("role");
  
  const sidebarManageBtn = document.getElementById("manageTeamSidebarBtn");
  const calToggle = document.getElementById("calendarToggle");
  const notifWrapper = document.getElementById("notificationWrapper");
  const fabGrantBtn = document.getElementById("fabGrantBtn");

  if (calToggle) calToggle.style.setProperty("display", "flex", "important");
  if (notifWrapper) notifWrapper.style.display = "flex";
  if (fabGrantBtn) fabGrantBtn.style.setProperty("display", "flex", "important");
  
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
    // 🔥 加一個 t=Date.now() 參數，破解 304 快取魔咒
    const res = await fetch(`/leaves/notifications?t=${Date.now()}`, { 
      headers: { Authorization: `Bearer ${token}` } 
    });

    if (res.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login.html";
      return;
    }

    const data = await res.json();
    if (data.success) {
      const u = data.userInfo;
      const displayRank = u.rank ? u.rank : (roleMap[u.role] || u.role);
      
      const nameEl = document.getElementById("user-profile-name");
      if (nameEl) nameEl.innerText = `${u.name} (${displayRank})`;
      
      const initEl = document.getElementById("headerProfileInitials");
      if (initEl) initEl.innerText = u.name.charAt(0);

      // 🔥 強制解除隱藏，確保小鈴鐺永遠存在畫面上
      const notifWrapper = document.getElementById("notificationWrapper");
      if (notifWrapper) {
          notifWrapper.classList.remove("hidden");
          notifWrapper.style.display = "flex";
      }

      renderNotifications(data.notifications, u.role);
    }
  } catch (e) {
    console.error("🔔 알림 데이터 로드 실패:", e);
  }
}

// 🔥 友善的時間格式化函數
function timeAgo(dateString) {
  const now = new Date();
  const past = new Date(dateString);
  const diffMins = Math.floor((now - past) / 60000);
  if (diffMins < 60) return `${diffMins}분 전`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}시간 전`;
  return `${Math.floor(diffHrs / 24)}일 전`;
}

window.closeNotifications = function() {
  const dropdown = document.getElementById("notificationDropdown");
  if (dropdown) dropdown.classList.add("hidden");
};

function toggleNotifications() {
  const dropdown = document.getElementById("notificationDropdown");
  if (dropdown) dropdown.classList.toggle("hidden");
}

function renderNotifications(notifications, role) {
  const listEl = document.getElementById("notificationList");
  const badgeEl = document.getElementById("notificationBadge");
  const approveAllBtn = document.getElementById("approveAllBtn");

  if (!listEl) return;

  if (!notifications || notifications.length === 0) {
    listEl.innerHTML = `
      <div class="p-8 text-center text-slate-400">
        <div class="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
           <i class="fa-solid fa-bell-slash text-xl text-slate-300"></i>
        </div>
        <p class="text-xs font-bold text-slate-500">새로운 알림이 없습니다.</p>
      </div>`;
    if (badgeEl) badgeEl.classList.add("hidden");
    if (approveAllBtn) approveAllBtn.classList.add("hidden");
    return;
  }

  if (badgeEl) {
    badgeEl.innerText = notifications.length;
    badgeEl.className = "absolute top-0 right-0 transform translate-x-1/4 -translate-y-1/4 bg-red-500 text-white text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full border-2 border-white shadow-sm z-10";
    badgeEl.classList.remove("hidden");
  }
  
  if (approveAllBtn && ["reviewer", "approver", "officer", "superadmin"].includes(role)) {
    approveAllBtn.classList.remove("hidden");
  }

  const isIndex = window.location.pathname === '/' || window.location.pathname === '/index.html' || window.location.pathname === '';

  listEl.innerHTML = notifications.map(noti => {
    let icon = "fa-bell", color = "text-indigo-600", bgColor = "bg-indigo-50 border-indigo-100", actionButtons = "", clickAction = "";
    let statusText = noti.reason;
    
if (noti.status === "PENDING_REVIEW" || noti.status === "CANCEL_REQ_REVIEW") {
      icon = "fa-clipboard-check"; color = "text-amber-600"; bgColor = "bg-amber-50 border-amber-100";
      statusText = noti.status.includes("CANCEL") ? "취소 검토 요청" : "새로운 출타 검토 요청";
      clickAction = `window.closeNotifications(); spaNavigate('/review?id=${noti._id}');`; 
      actionButtons = `
        <div class="flex gap-2 mt-2.5">
          <button onclick="event.stopPropagation(); window.closeNotifications(); quickReview('${noti._id}', 'approve')" class="flex-1 text-[11px] font-bold bg-indigo-600 text-white py-1.5 rounded-md hover:bg-indigo-700 transition shadow-sm">검토완료</button>
          <button onclick="event.stopPropagation(); window.closeNotifications(); quickReview('${noti._id}', 'reject')" class="flex-1 text-[11px] font-bold bg-white border border-red-200 text-red-500 py-1.5 rounded-md hover:bg-red-50 transition shadow-sm">반려</button>
        </div>`;
    } else if (noti.status === "PENDING_APPROVAL" || noti.status === "CANCEL_REQ_APPROVAL") {
      icon = "fa-file-signature"; color = "text-blue-600"; bgColor = "bg-blue-50 border-blue-100";
      statusText = noti.status.includes("CANCEL") ? "취소 승인 대기" : "최종 승인 대기 문서";
      clickAction = `window.closeNotifications(); spaNavigate('/approve?id=${noti._id}');`;
      actionButtons = `
        <div class="flex gap-2 mt-2.5">
          <button onclick="event.stopPropagation(); window.closeNotifications(); quickApprove('${noti._id}', 'approve')" class="flex-1 text-[11px] font-bold bg-indigo-600 text-white py-1.5 rounded-md hover:bg-indigo-700 transition shadow-sm">최종승인</button>
          <button onclick="event.stopPropagation(); window.closeNotifications(); quickApprove('${noti._id}', 'reject')" class="flex-1 text-[11px] font-bold bg-white border border-red-200 text-red-500 py-1.5 rounded-md hover:bg-red-50 transition shadow-sm">반려</button>
        </div>`;
    } else if (noti.status === "NEW_MEMBER_PENDING") {
      icon = "fa-user-plus"; color = "text-emerald-600"; bgColor = "bg-emerald-50 border-emerald-100"; 
      statusText = "신규 부대원 가입 대기";
      clickAction = `window.closeNotifications(); spaNavigate('/adduser');`;
    } else if (noti.status.includes("REJECTED") || noti.status === "CANCEL_APPROVED") {
      
      // 🔥 如果是取消成功，顯示灰色 UI
      if (noti.status === "CANCEL_APPROVED") {
        icon = "fa-calendar-minus"; color = "text-gray-500"; bgColor = "bg-gray-100 border-gray-200";
        statusText = "휴가 취소가 최종 승인되어 일수가 반환되었습니다.";
      } 
      // 🔥 如果是拒絕，顯示紅色 UI
      else {
        icon = "fa-circle-xmark"; color = "text-red-500"; bgColor = "bg-red-50 border-red-100";
        statusText = "출타 신청이 반려되었습니다.";
      }
      
      const targetDate = noti.startDate ? noti.startDate.split('T')[0] : '';
      
      // 點擊後跳轉回月曆，並照亮該灰色的 EventBar
      clickAction = isIndex 
        ? `window.closeNotifications(); if(typeof executeSearchNavigation === 'function') executeSearchNavigation('${noti._id}', '${noti.type}', '${targetDate}');` 
        : `window.closeNotifications(); spaNavigate('/?focus=${noti._id}&date=${targetDate}&type=${noti.type}');`;
        
    } else if (noti.status === "DISCHARGE_TODAY") {
      icon = "fa-medal"; color = "text-purple-600"; bgColor = "bg-purple-50 border-purple-100";
      statusText = "오늘 전역 예정입니다.";
      clickAction = `window.closeNotifications(); spaNavigate('/adduser');`;
    } else if (noti.status === "PASSWORD_RESET_REQ") {
      icon = "fa-key"; color = "text-rose-600"; bgColor = "bg-rose-50 border-rose-100";
      statusText = "비밀번호 초기화 요청";
      clickAction = `window.closeNotifications();`;
    }
    return `
      <div id="noti-${noti._id}" class="noti-item p-4 hover:bg-slate-50 border-b border-slate-100 transition-all flex items-start gap-3.5 group cursor-pointer" onclick="${clickAction}">
        <div class="w-9 h-9 rounded-full ${bgColor} border flex items-center justify-center shrink-0 shadow-sm transition-transform group-hover:scale-105">
          <i class="fa-solid ${icon} ${color} text-[13px]"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-start mb-1">
            <p class="text-[13px] font-black text-slate-800 truncate pr-2">
  ${noti.userId ? (noti.userId.name || "알 수 없음") : "시스템 알림"} 
  <span class="text-[10px] text-slate-500 font-medium">
    (${noti.userId?.rank || '정보 없음'})
  </span>
</p>
            <span class="text-[10px] font-bold text-indigo-400 whitespace-nowrap bg-indigo-50 px-1.5 py-0.5 rounded">
  ${timeAgo(noti.updatedAt || noti.createdAt || new Date())}
</span>
          </div>
          <p class="text-xs text-slate-600 line-clamp-1 font-medium">${statusText} <span class="text-slate-400 font-normal">- ${noti.reason}</span></p>
          ${actionButtons}
        </div>
      </div>
    `;
  }).join("");
}

// 🛡️ API 防呆：小鈴鐺專屬一鍵審核 (嚴格白名單模式)
window.approveAllLeaves = async function() {
  if (!confirm("알림창 내의 [정규 편성(정원 내)] 일반 휴가만 일괄 처리하시겠습니까?\n(⚠️ 안전을 위해 '후보', '취소 신청', '인원 추가' 등의 알림은 제외됩니다.)")) return;
  const token = localStorage.getItem("token");
  try {
    const res = await fetch("/leaves/approve-all", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { window.location.href = "/login.html"; return; }
    const data = await res.json();
    
    // 🔥 優化 UX：告訴長官有哪些東西被系統「安全攔截」跳過了
    if (data.success) {
        let alertMsg = data.message;
        if (data.skippedCount > 0) {
            alertMsg += `\n\n🚨 주의: ${data.skippedCount}건의 알림(후보, 취소신청, 신규가입 등)은 안전을 위해 제외되었습니다. 직접 클릭하여 확인해주세요.`;
        }
        alert(alertMsg);
        checkPendingLeaves(); // 重新整理小鈴鐺
        if(typeof refreshCalendarData === "function") refreshCalendarData(); // 更新月曆
    } else {
        alert(data.error);
    }
  } catch (e) { alert("처리 중 오류가 발생했습니다."); }
};

// 🛡️ API 防呆：快速檢討
window.quickReview = async function(id, action) {
  const token = localStorage.getItem("token");
  const path = action === 'approve' ? 'review' : 'reject';
  if(!confirm(action === 'approve' ? "검토 완료하시겠습니까?" : "반려하시겠습니까?")) return;
  
  try {
    const res = await fetch(`/leaves/${id}/${path}`, { method: "PUT", headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { window.location.href = "/login.html"; return; }
    const data = await res.json();
    if(data.success) {
      checkPendingLeaves();
      if(typeof refreshCalendarData === "function") refreshCalendarData(); 
    }
  } catch (e) { alert("처리 중 오류 발생"); }
};

// 🛡️ API 防呆：快速最終核准
window.quickApprove = async function(id, action) {
  const token = localStorage.getItem("token");
  const path = action === 'approve' ? 'approve' : 'reject';
  if(!confirm(action === 'approve' ? "최종 승인하시겠습니까?" : "반려하시겠습니까?")) return;
  
  try {
    const res = await fetch(`/leaves/${id}/${path}`, { method: "PUT", headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { window.location.href = "/login.html"; return; }
    const data = await res.json();
    if(data.success) {
      checkPendingLeaves();
      if(typeof refreshCalendarData === "function") refreshCalendarData();
    }
  } catch (e) { alert("처리 중 오류 발생"); }
};

function logout() {
  if (confirm("로그아웃 하시겠습니까?")) {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  }
}

// 🔥 攔截點擊事件：SPA 跳轉 + 全域下拉選單關閉邏輯
document.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (link && link.href && link.href.startsWith(window.location.origin) && !link.hasAttribute("target")) {
    if (link.href.includes("logout") || link.onclick?.toString().includes("logout")) return;
    e.preventDefault();
    spaNavigate(link.href);
  }

  const notiDropdown = document.getElementById("notificationDropdown");
  const notiBtn = document.getElementById("notificationWrapper");
  if (notiDropdown && !notiDropdown.classList.contains("hidden")) {
    if (!notiDropdown.contains(e.target) && !notiBtn.contains(e.target)) {
      notiDropdown.classList.add("hidden");
    }
  }

  const searchDropdown = document.getElementById("globalSearchDropdown");
  const searchInput = document.getElementById("globalSearchInput");
  if (searchDropdown && !searchDropdown.classList.contains("hidden")) {
    if (!searchDropdown.contains(e.target) && e.target !== searchInput) {
      searchDropdown.classList.add("hidden");
    }
  }
});

// 處理瀏覽器返回鍵
window.addEventListener("popstate", () => {
  window.location.reload();
});

// 初始載入
document.addEventListener("DOMContentLoaded", applyRolePermissions);