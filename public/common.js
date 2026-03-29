const roleMap = {
  soldier: "용사",
  officer: "간부",
  reviewer: "검토자",
  approver: "승인자",
};

// ==========================================
// 💡 全局聚光燈特效引擎 (終極 JS 實體渲染版 - 無視任何 CSS 衝突)
// ==========================================
window.checkAndHighlightFocus = function () {
  const urlParams = new URLSearchParams(window.location.search);
  const focusId = urlParams.get("focus");

  if (!focusId) return;

  let attempts = 0;
  const tryHighlight = () => {
    const targetElement = document.getElementById(`item-${focusId}`);

    if (targetElement && !targetElement.dataset.highlighted) {
      targetElement.dataset.highlighted = "true";

      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });

      const styleId = `glow-style-${focusId}`;
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.innerHTML = `
                  html body div#item-${focusId}, 
                  html body main #userList div#item-${focusId},
                  html body main #pendingList div#item-${focusId} {
                      transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
                      z-index: 100 !important;
                      position: relative !important;
                      transform: scale(1.02) !important;
                      outline: 2px solid rgba(99, 102, 241, 0.8) !important;
                      outline-offset: 2px !important;
                      background-color: #eef2ff !important; 
                  }
              `;
        document.head.appendChild(style);

        setTimeout(() => {
          const existingStyle = document.getElementById(styleId);
          if (existingStyle) existingStyle.remove();
          targetElement.removeAttribute("data-highlighted");

          const newUrl = window.location.origin + window.location.pathname;
          window.history.replaceState({}, "", newUrl);
        }, 2500);
      }
    } else if (attempts < 50) {
      attempts++;
      setTimeout(tryHighlight, 150);
    }
  };
  tryHighlight();
};

// ==========================================
// 🚀 SmartMil 終極 SPA 導航引擎
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
    const fetchUrl =
      url + (url.includes("?") ? "&" : "?") + "t=" + new Date().getTime();
    const res = await fetch(fetchUrl, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    document.title = doc.title;
    document.body.className = doc.body.className;

    const currentStyles = Array.from(
      document.querySelectorAll("style:not([id])")
    ).map((s) => s.textContent.trim());

    doc.querySelectorAll("style:not([id])").forEach((s) => {
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
            newScript.onload = () => {
              resolve();
              newScript.remove();
            };
            newScript.onerror = () => {
              resolve();
              newScript.remove();
            };
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
// 🚀 喚醒機制 (加上聚光燈呼叫)
// ==========================================
function reInitializePage() {
  applyRolePermissions();
  const path = window.location.pathname.toLowerCase();

  setTimeout(() => {
    if (path.includes("adduser")) {
      if (typeof window.fetchUsers === "function") window.fetchUsers();
    } else if (path.includes("settings")) {
      if (typeof window.loadSettingsPage === "function")
        window.loadSettingsPage();
    } else if (path.includes("review")) {
      if (typeof window.initReviewPage === "function") window.initReviewPage();
    } else if (path.includes("approve")) {
      if (typeof window.initApprovePage === "function")
        window.initApprovePage();
    } else {
      if (typeof window.initCalendarPage === "function")
        window.initCalendarPage();
    }

    window.checkAndHighlightFocus();
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
  if (fabGrantBtn)
    fabGrantBtn.style.setProperty("display", "flex", "important");

  if (["reviewer", "approver", "superadmin"].includes(userRole)) {
    if (sidebarManageBtn)
      sidebarManageBtn.style.setProperty("display", "flex", "important");
  } else {
    if (sidebarManageBtn)
      sidebarManageBtn.style.setProperty("display", "none", "important");
  }

  checkPendingLeaves();
}

async function checkPendingLeaves() {
  const token = localStorage.getItem("token");
  if (!token) return;

  try {
    const res = await fetch(`/leaves/notifications?t=${Date.now()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login.html";
      return;
    }

    const data = await res.json();
    if (data.success) {
      const u = data.userInfo;
      const displayRank = u.rank ? u.rank : roleMap[u.role] || u.role;

      const nameEl = document.getElementById("user-profile-name");
      if (nameEl) nameEl.innerText = `${u.name} (${displayRank})`;

      const initEl = document.getElementById("headerProfileInitials");
      if (initEl) initEl.innerText = u.name.charAt(0);

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

function timeAgo(dateString) {
  const now = new Date();
  const past = new Date(dateString);
  const diffMins = Math.floor((now - past) / 60000);
  if (diffMins < 60) return `${diffMins}분 전`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}시간 전`;
  return `${Math.floor(diffHrs / 24)}일 전`;
}

window.closeNotifications = function () {
  const dropdown = document.getElementById("notificationDropdown");
  if (dropdown) dropdown.classList.add("hidden");
};

function toggleNotifications() {
  const dropdown = document.getElementById("notificationDropdown");
  if (dropdown) dropdown.classList.toggle("hidden");
}

window.markNoticeAsRead = function (noticeId) {
  let readNotices = JSON.parse(localStorage.getItem("readNotices") || "[]");
  if (!readNotices.includes(noticeId)) {
    readNotices.push(noticeId);
    localStorage.setItem("readNotices", JSON.stringify(readNotices));
  }
  window.closeNotifications();
  spaNavigate(`/notice?focus=${noticeId}`);
};

// 🔥 [修改] 點擊日曆通知的全局處理函數 (配合兩段式消除邏輯)
window.handleNotificationClick = function (id, dateStr, type, status, isIndex) {
  const role = localStorage.getItem("role") || "soldier";

  // 判斷這是不是「退回、強制取消、取消核准」的假單
  const isReturnedLeave = [
    "FORCE_CANCELLED",
    "REJECTED_REVIEW",
    "REJECTED_APPROVAL",
    "CANCEL_APPROVED",
  ].includes(status);

  // 若是勇士，將點擊過的通知 ID 記入口袋 (已讀)
  if (role === "soldier") {
    // 🔥 如果「不是」被退回的假單 (例如 APPROVED)，點擊小鈴鐺就直接消除
    if (!isReturnedLeave) {
      let dismissed = JSON.parse(
        localStorage.getItem("dismissedItems") || "[]"
      );
      if (!dismissed.includes(id)) {
        dismissed.push(id);
        localStorage.setItem("dismissedItems", JSON.stringify(dismissed));
      }
      checkPendingLeaves(); // 點擊後立刻更新小鈴鐺
    }
    // 如果是退回的假單，我們在這裡「什麼都不做」，保留通知，等待使用者去點擊月曆上的灰色格子
  }

  window.closeNotifications();

  // 執行跳轉與閃爍特效
  if (dateStr) {
    if (isIndex && typeof executeSearchNavigation === "function") {
      executeSearchNavigation(id, type, dateStr);
    } else {
      spaNavigate(`/?focus=${id}&date=${dateStr}&type=${type}`);
    }
  }
};

// 🔥 [新增] 強化版日曆發光函數 (解決跨週末假單只亮一半的問題)
window.highlightCalendarEvent = function (eventId) {
  if (!window.calendar) return;
  const event = window.calendar.getEventById(eventId);
  if (event) {
    const origBg = event.backgroundColor;
    const origBorder = event.borderColor;

    // 透過 setProp 直接修改事件屬性，FullCalendar 會自動把屬於該事件的所有 HTML 區塊都換色！
    event.setProp("backgroundColor", "#fef08a");
    event.setProp("borderColor", "#eab308");

    setTimeout(() => {
      event.setProp("backgroundColor", origBg);
      event.setProp("borderColor", origBorder);
    }, 2000);
  }
};

function renderNotifications(notifications, role) {
  const listEl = document.getElementById("notificationList");
  const badgeEl = document.getElementById("notificationBadge");

  if (!listEl) return;

  const readNotices = JSON.parse(localStorage.getItem("readNotices") || "[]");
  const dismissedItems = JSON.parse(
    localStorage.getItem("dismissedItems") || "[]"
  );

  const unreadNotifications = notifications.filter((noti) => {
    // 過濾已讀公告
    if (noti.status === "SYSTEM_NOTICE" || noti.type === "NOTICE") {
      return !readNotices.includes(noti._id);
    }
    // 🔥 [新增] 過濾勇士已經點擊過的「已讀通知」
    if (role === "soldier" && dismissedItems.includes(noti._id)) {
      return false;
    }
    return true;
  });

  if (!unreadNotifications || unreadNotifications.length === 0) {
    listEl.innerHTML = `
      <div class="p-8 text-center text-slate-400">
        <div class="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
           <i class="fa-solid fa-bell-slash text-xl text-slate-300"></i>
        </div>
        <p class="text-xs font-bold text-slate-500">새로운 알림이 없습니다.</p>
      </div>`;
    if (badgeEl) badgeEl.classList.add("hidden");
    return;
  }

  if (badgeEl) {
    badgeEl.innerText = unreadNotifications.length;
    badgeEl.className =
      "absolute top-0 right-0 transform translate-x-1/4 -translate-y-1/4 bg-red-500 text-white text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full border-2 border-white shadow-sm z-10";
    badgeEl.classList.remove("hidden");
  }

  const isIndex =
    window.location.pathname === "/" ||
    window.location.pathname === "/index.html" ||
    window.location.pathname === "";

  listEl.innerHTML = unreadNotifications
    .map((noti) => {
      let icon = "fa-bell",
        color = "text-indigo-600",
        bgColor = "bg-indigo-50 border-indigo-100",
        actionButtons = "",
        clickAction = "";
      let statusText = noti.reason;

      if (
        noti.status === "PENDING_REVIEW" ||
        noti.status === "CANCEL_REQ_REVIEW"
      ) {
        icon = "fa-clipboard-check";
        color = "text-amber-600";
        bgColor = "bg-amber-50 border-amber-100";
        statusText = noti.status.includes("CANCEL")
          ? "취소 검토 요청"
          : "새로운 출타 검토 요청";
        clickAction = `window.closeNotifications(); spaNavigate('/review?id=${noti._id}');`;

        if (["reviewer", "officer", "superadmin"].includes(role)) {
          actionButtons = `
          <div class="flex gap-2 mt-2.5">
            <button onclick="event.stopPropagation(); window.closeNotifications(); quickReview('${noti._id}', 'approve')" class="flex-1 text-[11px] font-bold bg-indigo-600 text-white py-1.5 rounded-md hover:bg-indigo-700 transition shadow-sm">검토완료</button>
            <button onclick="event.stopPropagation(); window.closeNotifications(); quickReview('${noti._id}', 'reject')" class="flex-1 text-[11px] font-bold bg-white border border-red-200 text-red-500 py-1.5 rounded-md hover:bg-red-50 transition shadow-sm">반려</button>
          </div>`;
        } else {
          actionButtons = ``;
        }
      } else if (
        noti.status === "PENDING_APPROVAL" ||
        noti.status === "CANCEL_REQ_APPROVAL"
      ) {
        icon = "fa-file-signature";
        color = "text-blue-600";
        bgColor = "bg-blue-50 border-blue-100";
        statusText = noti.status.includes("CANCEL")
          ? "취소 승인 대기"
          : "최종 승인 대기 문서";
        clickAction = `window.closeNotifications(); spaNavigate('/approve?id=${noti._id}');`;

        if (["approver", "superadmin"].includes(role)) {
          actionButtons = `
          <div class="flex gap-2 mt-2.5">
            <button onclick="event.stopPropagation(); window.closeNotifications(); quickApprove('${noti._id}', 'approve')" class="flex-1 text-[11px] font-bold bg-indigo-600 text-white py-1.5 rounded-md hover:bg-indigo-700 transition shadow-sm">최종승인</button>
            <button onclick="event.stopPropagation(); window.closeNotifications(); quickApprove('${noti._id}', 'reject')" class="flex-1 text-[11px] font-bold bg-white border border-red-200 text-red-500 py-1.5 rounded-md hover:bg-red-50 transition shadow-sm">반려</button>
          </div>`;
        } else {
          actionButtons = ``;
        }
      } else if (noti.status === "NEW_MEMBER_PENDING") {
        icon = "fa-user-plus";
        color = "text-emerald-600";
        bgColor = "bg-emerald-50 border-emerald-100";
        statusText = "신규 부대원 가입 대기";
        clickAction = `window.closeNotifications(); spaNavigate('/adduser');`;
      } else if (noti.status === "APPROVED") {
        icon = "fa-check-double";
        color = "text-emerald-500";
        bgColor = "bg-emerald-50 border-emerald-100";
        statusText = "출타가 최종 승인되었습니다! 달력을 확인하세요.";
        const targetDate = noti.startDate ? noti.startDate.split("T")[0] : "";
        // 🔥 [修改] 套用全新的已讀處理點擊事件
        clickAction = `window.handleNotificationClick('${noti._id}', '${targetDate}', '${noti.type}', '${noti.status}', ${isIndex});`;
      } else if (
        noti.status.includes("REJECTED") ||
        noti.status === "CANCEL_APPROVED" ||
        noti.status === "FORCE_CANCELLED"
      ) {
        if (noti.status === "FORCE_CANCELLED") {
          icon = "fa-triangle-exclamation";
          color = "text-white";
          bgColor = "bg-red-600 border-red-700 animate-pulse shadow-md";
          statusText = "🚨 지휘관 직권으로 휴가가 강제 회수되었습니다.";
        } else if (noti.status === "CANCEL_APPROVED") {
          icon = "fa-calendar-minus";
          color = "text-gray-500";
          bgColor = "bg-gray-100 border-gray-200";
          statusText = "휴가 취소가 승인되어 일수가 반환되었습니다.";
        } else {
          icon = "fa-circle-xmark";
          color = "text-red-500";
          bgColor = "bg-red-50 border-red-100";
          statusText = "출타 신청이 반려되었습니다.";
        }

        const targetDate = noti.startDate ? noti.startDate.split("T")[0] : "";
        // 🔥 [修改] 套用全新的已讀處理點擊事件
        clickAction = `window.handleNotificationClick('${noti._id}', '${targetDate}', '${noti.type}', '${noti.status}', ${isIndex});`;
      } else if (noti.status === "DISCHARGE_TODAY") {
        icon = "fa-medal";
        color = "text-purple-600";
        bgColor = "bg-purple-50 border-purple-100";
        statusText = "오늘 전역 예정입니다.";
        clickAction = `window.closeNotifications(); spaNavigate('/adduser');`;
      } else if (noti.status === "SYSTEM_NOTICE" || noti.type === "NOTICE") {
        icon = "fa-bullhorn";
        color = "text-red-500";
        bgColor = "bg-red-50 border-red-100";
        statusText = "새로운 필독 공지";
        clickAction = `window.markNoticeAsRead('${noti._id}')`;
      } else if (noti.status === "PASSWORD_RESET_REQ") {
        icon = "fa-key";
        color = "text-rose-600";
        bgColor = "bg-rose-50 border-rose-100";
        statusText = "비밀번호 초기화 요청";
        clickAction = `window.closeNotifications();`;
      }

      if (noti.isWaitlisted) {
        actionButtons = ``;
        statusText = `[정원초과/후보] ${statusText}`;
      }

      return `
      <div id="noti-${
        noti._id
      }" class="noti-item p-4 hover:bg-slate-50 border-b border-slate-100 transition-all flex items-start gap-3.5 group cursor-pointer" onclick="${clickAction}">
        <div class="w-9 h-9 rounded-full ${bgColor} border flex items-center justify-center shrink-0 shadow-sm transition-transform group-hover:scale-105">
          <i class="fa-solid ${icon} ${color} text-[13px]"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-start mb-1">
            <p class="text-[13px] font-black text-slate-800 truncate pr-2">
              ${noti.userId ? noti.userId.name || "알 수 없음" : "시스템 알림"} 
              <span class="text-[10px] text-slate-500 font-medium">(${
                noti.userId?.rank || "정보 없음"
              })</span>
            </p>
            <span class="text-[10px] font-bold text-indigo-400 whitespace-nowrap bg-indigo-50 px-1.5 py-0.5 rounded">${timeAgo(
              noti.updatedAt || noti.createdAt || new Date()
            )}</span>
          </div>
          <p class="text-xs text-slate-600 line-clamp-1 font-medium">${statusText} <span class="text-slate-400 font-normal">- ${
        noti.reason || ""
      }</span></p>
          ${actionButtons}
        </div>
      </div>
    `;
    })
    .join("");
}

window.quickReview = async function (id, action) {
  const token = localStorage.getItem("token");
  const path = action === "approve" ? "review" : "reject";
  if (
    !confirm(
      action === "approve" ? "검토 완료하시겠습니까?" : "반려하시겠습니까?"
    )
  )
    return;

  try {
    const res = await fetch(`/leaves/${id}/${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      window.location.href = "/login.html";
      return;
    }
    const data = await res.json();
    if (data.success) {
      checkPendingLeaves();
      if (typeof refreshCalendarData === "function") refreshCalendarData();
    }
  } catch (e) {
    alert("처리 중 오류 발생");
  }
};

window.quickApprove = async function (id, action) {
  const token = localStorage.getItem("token");
  const path = action === "approve" ? "approve" : "reject";
  if (
    !confirm(
      action === "approve" ? "최종 승인하시겠습니까?" : "반려하시겠습니까?"
    )
  )
    return;

  try {
    const res = await fetch(`/leaves/${id}/${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      window.location.href = "/login.html";
      return;
    }
    const data = await res.json();
    if (data.success) {
      checkPendingLeaves();
      if (typeof refreshCalendarData === "function") refreshCalendarData();
    }
  } catch (e) {
    alert("처리 중 오류 발생");
  }
};

function logout() {
  if (confirm("로그아웃 하시겠습니까?")) {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  }
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (
    link &&
    link.href &&
    link.href.startsWith(window.location.origin) &&
    !link.hasAttribute("target")
  ) {
    if (
      link.href.includes("logout") ||
      link.onclick?.toString().includes("logout")
    )
      return;
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

  const searchDropdown = document.getElementById("inlineSearchDropdown");
  const searchInput = document.getElementById("inlineSearchInput");
  if (searchDropdown && !searchDropdown.classList.contains("hidden")) {
    if (!searchDropdown.contains(e.target) && e.target !== searchInput) {
      searchDropdown.classList.add("hidden");
    }
  }
});

// ==========================================
// 🔍 SmartMil 整合搜尋 (Inline Omni-Search)
// ==========================================
let inlineSearchTimeout = null;

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    const input = document.getElementById("inlineSearchInput");
    if (input) input.focus();
  }
  if (e.key === "Escape") {
    const dropdown = document.getElementById("inlineSearchDropdown");
    if (dropdown) dropdown.classList.add("hidden");
  }
});

window.handleInlineSearch = async function (query) {
  const dropdown = document.getElementById("inlineSearchDropdown");
  const resultsBox = document.getElementById("inlineSearchList");
  if (!dropdown || !resultsBox) return;

  if (!query.trim()) {
    dropdown.classList.add("hidden");
    return;
  }

  dropdown.classList.remove("hidden");
  clearTimeout(inlineSearchTimeout);

  resultsBox.innerHTML = `<div class="p-6 text-center text-gray-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-500 mb-2"></i><p class="text-xs font-bold">검색 중...</p></div>`;

  inlineSearchTimeout = setTimeout(async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `/api/omni-search?q=${encodeURIComponent(query)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json();

      if (data.success) {
        window.renderInlineResults(data.results, query);
      } else {
        resultsBox.innerHTML = `<div class="p-5 text-sm text-red-400 text-center">검색 중 오류가 발생했습니다.</div>`;
      }
    } catch (e) {
      resultsBox.innerHTML = `<div class="p-5 text-sm text-red-400 text-center">네트워크 오류가 발생했습니다.</div>`;
    }
  }, 250);
};

window.renderInlineResults = function (results, query) {
  const resultsBox = document.getElementById("inlineSearchList");
  let html = "";

  const userRole = localStorage.getItem("role") || "soldier";
  const isManager = ["reviewer", "officer", "approver", "superadmin"].includes(
    userRole
  );

  const hasUsers = isManager && results.users && results.users.length > 0;
  const hasLeaves = results.leaves && results.leaves.length > 0;
  const hasNotices = results.notices && results.notices.length > 0;
  const hasGalleries = results.galleries && results.galleries.length > 0;

  if (!hasUsers && !hasLeaves && !hasNotices && !hasGalleries) {
    resultsBox.innerHTML = `<div class="p-6 text-center text-gray-400"><i class="fa-solid fa-magnifying-glass-minus text-2xl mb-2 text-gray-300 block"></i><p class="text-[11px] font-bold text-gray-500">'${query}'에 대한 결과가 없습니다.</p></div>`;
    return;
  }

  if (hasUsers) {
    html += `<div class="mb-1.5"><h4 class="text-[10px] font-black text-blue-500 mb-1 px-2 uppercase tracking-wider mt-1"><i class="fa-solid fa-users mr-1"></i>부대원</h4><div class="flex flex-col gap-0.5">`;
    results.users.forEach((u) => {
      const rank =
        typeof window.getDisplayRank === "function"
          ? window.getDisplayRank(u)
          : u.rank || "용사";
      html += `
        <button onclick="document.getElementById('inlineSearchDropdown').classList.add('hidden'); spaNavigate('/adduser?focus=${
          u._id
        }')" class="flex items-center justify-between p-2 rounded-lg hover:bg-blue-50 border border-transparent transition text-left group">
          <div class="flex items-center gap-2.5">
            <div class="w-6 h-6 rounded-full bg-blue-100 text-blue-600 font-black flex items-center justify-center shadow-inner text-[10px]">${u.name.charAt(
              0
            )}</div>
            <div><p class="text-xs font-bold text-gray-800">${
              u.name
            } <span class="text-[9px] text-gray-500 font-normal">(${rank})</span></p></div>
          </div>
          <i class="fa-solid fa-arrow-right text-blue-200 group-hover:text-blue-500 transition-colors text-[10px] opacity-0 group-hover:opacity-100"></i>
        </button>`;
    });
    html += `</div></div>`;
  }

  if (hasLeaves) {
    html += `<div class="mb-1.5"><h4 class="text-[10px] font-black text-emerald-500 mb-1 px-2 uppercase tracking-wider mt-1"><i class="fa-solid fa-calendar-check mr-1"></i>출타 내역</h4><div class="flex flex-col gap-0.5">`;
    results.leaves.forEach((l) => {
      const sDate = l.startDate.split("T")[0];
      const isApproved = l.status === "APPROVED";

      const isCalPage = ["/", "/index.html"].includes(window.location.pathname);
      const clickAction = isCalPage
        ? `document.getElementById('inlineSearchDropdown').classList.add('hidden'); window.executeSearchNavigation('${l._id}', '${l.type}', '${sDate}');`
        : `document.getElementById('inlineSearchDropdown').classList.add('hidden'); window.spaNavigate('/?focus=${l._id}&date=${sDate}&type=${l.type}');`;

      html += `
        <button onclick="${clickAction}" class="flex flex-col p-2 rounded-lg hover:bg-emerald-50 border border-transparent transition text-left group">
          <div class="flex justify-between items-center w-full mb-0.5">
            <span class="text-xs font-bold text-gray-800"><span class="text-emerald-600 mr-1">[${
              l.type
            }]</span>${l.userId?.name || "알수없음"}</span>
            ${
              isApproved
                ? '<i class="fa-solid fa-check text-emerald-500 text-[9px]"></i>'
                : '<i class="fa-solid fa-clock text-amber-500 text-[9px]"></i>'
            }
          </div>
          <p class="text-[10px] text-gray-500 truncate"><i class="fa-regular fa-calendar mr-1"></i>${sDate.replace(
            /-/g,
            "."
          )} | ${l.reason}</p>
        </button>`;
    });
    html += `</div></div>`;
  }

  if (hasNotices) {
    html += `<div class="mb-1.5"><h4 class="text-[10px] font-black text-amber-500 mb-1 px-2 uppercase tracking-wider mt-1"><i class="fa-solid fa-bullhorn mr-1"></i>공지사항</h4><div class="flex flex-col gap-0.5">`;
    results.notices.forEach((n) => {
      const date = new Date(n.createdAt).toLocaleDateString();
      html += `
        <button onclick="document.getElementById('inlineSearchDropdown').classList.add('hidden'); spaNavigate('/notice?focus=${n._id}')" class="flex flex-col p-2 rounded-lg hover:bg-amber-50 border border-transparent transition text-left group">
          <p class="text-xs font-bold text-gray-800 truncate w-full mb-0.5 group-hover:text-amber-700">${n.title}</p>
          <p class="text-[9px] text-gray-400">${date}</p>
        </button>`;
    });
    html += `</div></div>`;
  }

  if (hasGalleries) {
    html += `<div class="mb-1.5"><h4 class="text-[10px] font-black text-pink-500 mb-1 px-2 uppercase tracking-wider mt-1"><i class="fa-regular fa-image mr-1"></i>사진첩</h4><div class="flex flex-col gap-0.5">`;
    results.galleries.forEach((g) => {
      const date = new Date(g.createdAt).toLocaleDateString();
      html += `
        <button onclick="document.getElementById('inlineSearchDropdown').classList.add('hidden'); spaNavigate('/gallery?focus=${
          g._id
        }')" class="flex flex-col p-2 rounded-lg hover:bg-pink-50 border border-transparent transition text-left group">
          <p class="text-xs font-bold text-gray-800 truncate w-full mb-0.5 group-hover:text-pink-700">${
            g.title || "제목 없음"
          }</p>
          <p class="text-[9px] text-gray-400">${date}</p>
        </button>`;
    });
    html += `</div></div>`;
  }

  resultsBox.innerHTML = html;
};

window.addEventListener("popstate", () => {
  window.location.reload();
});

document.addEventListener("DOMContentLoaded", () => {
  applyRolePermissions();
  window.checkAndHighlightFocus();
});
