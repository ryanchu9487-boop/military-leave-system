/**
 * SmartMil Unified Calendar Logic - 終極防呆、自動排備取、抽屜選單與完整申請版
 */

const GOOGLE_API_KEY = "AIzaSyBDbm1GF1W0wKYXSeAoIj3F8TJbmn7wHuw";
const KOREA_HOLIDAY_CALENDAR_ID = "ko.south_korea#holiday@group.v.calendar.google.com";

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let renderStartDate = null;
let renderEndDate = null;
let dbLeavesCache = [];
let leavesCache = [];
let currentToken = localStorage.getItem("token") || "";
let currentUserRole = localStorage.getItem("role") || "soldier";

let currentCalendarMode = "personal"; // 'personal', 'team-long', 'team-short'
let myAvailableSlots = [];
let currentUsedSlots = [];
let isDragging = false;
let dragStartStr = null;
let dragEndStr = null;

window.onload = async function () {
  if (!currentToken) {
    window.location.href = "/login.html";
    return;
  }
  
  try {
    const profileRes = await fetch("/profile", { headers: { Authorization: `Bearer ${currentToken}` } });
    const profileData = await profileRes.json();
    if (profileData.user) {
      currentUserRole = profileData.user.role;
      localStorage.setItem("role", currentUserRole);
    }
  } catch (e) {}

  injectFloatingUI();
  setupProUX();
  await initApp();
};

async function initApp() {
  // 🔥 1. 優先檢查 URL 參數，決定「初始月份」
  const urlParams = new URLSearchParams(window.location.search);
  const focusId = urlParams.get("focus");
  const targetDateStr = urlParams.get("date");

  if (focusId && targetDateStr) {
    // 跨頁面導航：直接把初始時間設定在目標月份！
    const targetDate = new Date(targetDateStr);
    currentYear = targetDate.getFullYear();
    currentMonth = targetDate.getMonth();
  } else {
    // 正常登入：設定為今天
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
  }
  
  // 🔥 2. 這裡畫出來的月曆，直接就是目標月份了！
  await refreshCalendarData();
  await fetchLeaveRates();
  setupScrollObserver();
  setupDragSelection();
  
  setTimeout(async () => {
    if (focusId) {
      const type = urlParams.get("type");
      // 清除網址列參數，保持乾淨
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // 啟動聚光燈導航 (傳入 false 代表「不要平滑滾動」，瞬間切換)
      await executeSearchNavigation(focusId, type, targetDateStr, false);
    } else {
      // 正常載入
      scrollToMonth(currentYear, currentMonth, false);
    }
  }, 100); // 等待初始渲染完成
}

async function refreshCalendarData() {
  await fetchLeavesFromDB();
  await resetCalendarTo(currentYear, currentMonth);
  updateModeUI();
}

async function switchCalendarMode(mode) {
  if (currentCalendarMode === mode) return;
  currentCalendarMode = mode;
  // 🔥 [修復] 切換模式時，必須強制重新去資料庫抓資料 (因為 endpoint 會從 /my 變成 /all)
  await refreshCalendarData(); 
}

function updateModeUI() {
  const btnPersonal = document.getElementById("btnPersonal");
  const btnTeamLong = document.getElementById("btnTeamLong");
  const btnTeamShort = document.getElementById("btnTeamShort");
  const batchApproveBtn = document.getElementById("batchApproveBtn");
  const settingsModalBtn = document.getElementById("settingsModalBtn");

  const activeClass = "px-5 py-2 bg-white shadow-sm rounded-md text-sm font-bold text-gray-800 transition";
  const inactiveClass = "px-5 py-2 text-sm font-bold text-gray-500 hover:text-gray-800 transition";

  if (btnPersonal) btnPersonal.className = currentCalendarMode === "personal" ? activeClass : inactiveClass;
  if (btnTeamLong) btnTeamLong.className = currentCalendarMode === "team-long" ? activeClass : inactiveClass;
  if (btnTeamShort) btnTeamShort.className = currentCalendarMode === "team-short" ? activeClass : inactiveClass;

  // 🔥 判斷是否為長官
  const isManager = ["reviewer", "officer", "approver", "superadmin"].includes(currentUserRole);

  // ⚙️ 齒輪按鈕 (出島率設定)：只要是長官就永遠顯示
  if (settingsModalBtn) {
    if (isManager) settingsModalBtn.classList.remove("hidden");
    else settingsModalBtn.classList.add("hidden");
  }

  // 📝 一鍵結算按鈕：長官 + 必須在「全體月曆模式」才顯示
  if (batchApproveBtn) {
    if (isManager && currentCalendarMode !== "personal") {
      batchApproveBtn.classList.remove("hidden");
    } else {
      batchApproveBtn.classList.add("hidden");
    }
  }
}

// 🔥 [修改] 將結算按鈕 API 修改為專屬月曆的正取結算 (Phase 1)
async function batchApprovePhase1() {
  if (!confirm("현재 월력에 표시된 [정규 편성(정원 내)] 인원만 일괄 승인/검토완료 처리하시겠습니까?\n(후보 인원은 제외됩니다)")) return;
  try {
    const res = await fetch(`/leaves/approve-calendar-phase1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    const data = await res.json();
    alert(data.message || data.error);
    if (data.success) {
      await refreshCalendarData();
    }
  } catch (e) {
    alert("오류가 발생했습니다.");
  }
}

function injectFloatingUI() {
  const container = document.getElementById("calendar").parentElement;
  container.classList.add("relative");
  container.style.paddingTop = "0px";
  if (document.getElementById("floatingPill")) return;

  const pill = document.createElement("div");
  pill.id = "floatingPill";
  pill.className = "dynamic-island absolute left-1/2 -translate-x-1/2 z-30 bg-white/95 backdrop-blur-md border border-gray-200/60 shadow-md rounded-full px-2 py-1.5 flex items-center gap-1 transition-all duration-300 hover:shadow-lg";
  pill.style.top = "42px"; 
  pill.innerHTML = `
    <button onclick="prevMonth(); event.stopPropagation();" class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition"><i class="fa-solid fa-chevron-left text-xs"></i></button>
    <div class="relative">
      <div class="px-3 text-sm font-black text-gray-800 hover:text-indigo-600 transition tracking-tight flex items-center gap-1.5 cursor-pointer" onclick="toggleMonthPicker()">
        <span id="floatingYearMonth">${currentYear}년 ${currentMonth + 1}월</span>
        <i class="fa-solid fa-caret-down text-[10px] text-gray-400"></i>
      </div>
      <div id="miniPickerBox" class="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-64 bg-white rounded-xl shadow-xl border border-gray-100 opacity-0 pointer-events-none transform scale-95 origin-top transition-all duration-200 z-40">
        <div class="flex p-2 gap-2 h-40">
          <div class="flex-1 overflow-y-auto scrollbar-hide space-y-1 snap-y" id="miniYearList"></div>
          <div class="w-px bg-gray-100"></div>
          <div class="flex-1 overflow-y-auto scrollbar-hide space-y-1 snap-y" id="miniMonthList"></div>
        </div>
      </div>
    </div>
    <button onclick="nextMonth(); event.stopPropagation();" class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition"><i class="fa-solid fa-chevron-right text-xs"></i></button>
    <div class="w-px h-3 bg-gray-300/60 mx-1"></div>
    <button onclick="goToCurrentMonth(); event.stopPropagation();" class="px-3 py-1 rounded-full text-xs font-bold text-indigo-600 hover:bg-indigo-50 transition">오늘</button>
  `;
  container.appendChild(pill);
}

function setupProUX() {
  const tooltip = document.createElement("div");
  tooltip.id = "proTooltip";
  tooltip.className = "glass-tooltip fixed pointer-events-none z-[120] opacity-0 bg-white/90 backdrop-blur-md border border-gray-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-xl p-3 transform -translate-x-1/2 -translate-y-[calc(100%+12px)] min-w-[180px] transition-opacity duration-150";
  document.body.appendChild(tooltip);

  document.addEventListener("mouseover", (e) => {
    if (e.target && typeof e.target.className === "string" && !e.target.className.includes("leave-bar")) {
      hideProTooltip();
    }
  });
  document.getElementById("calendar").addEventListener("scroll", hideProTooltip, { passive: true });
}

function showProTooltip(e, title, dates, reason, color) {
  const tt = document.getElementById("proTooltip");
  tt.innerHTML = `<div class="flex items-center gap-2 mb-1.5"><div class="w-2.5 h-2.5 rounded-full shadow-sm" style="background-color: ${color}"></div><span class="font-black text-gray-800 text-[13px] tracking-tight">${title}</span></div><div class="text-[11px] text-gray-500 font-medium font-mono bg-gray-50 rounded px-1.5 py-0.5 inline-block mb-1.5"><i class="fa-regular fa-calendar mr-1"></i>${dates}</div><div class="text-[12px] text-gray-600 leading-snug break-words">${reason}</div>`;
  tt.style.left = e.clientX + "px";
  tt.style.top = e.clientY + "px";
  tt.classList.remove("opacity-0", "scale-95");
}
function moveProTooltip(e) {
  const tt = document.getElementById("proTooltip");
  tt.style.left = e.clientX + "px";
  tt.style.top = e.clientY + "px";
}
function hideProTooltip() {
  const tt = document.getElementById("proTooltip");
  if (tt) tt.classList.add("opacity-0", "scale-95");
}

function toggleMonthPicker() {
  const box = document.getElementById("miniPickerBox");
  if (box.classList.contains("pointer-events-none")) {
    renderMiniPickerLists();
    box.classList.remove("opacity-0", "pointer-events-none", "scale-95");
  } else {
    box.classList.add("opacity-0", "pointer-events-none", "scale-95");
  }
}

document.addEventListener("click", (e) => {
  const box = document.getElementById("miniPickerBox");
  const pill = document.getElementById("floatingPill");
  if (box && !box.classList.contains("pointer-events-none") && !pill.contains(e.target)) {
    box.classList.add("opacity-0", "pointer-events-none", "scale-95");
  }
});

function renderMiniPickerLists() {
  const yList = document.getElementById("miniYearList");
  const mList = document.getElementById("miniMonthList");
  yList.innerHTML = "";
  mList.innerHTML = "";
  for (let y = currentYear - 3; y <= currentYear + 3; y++) {
    const btn = document.createElement("button");
    const active = y === currentYear;
    btn.className = `w-full py-1.5 text-xs rounded-md font-bold snap-center transition ${active ? "bg-indigo-50 text-indigo-600" : "text-gray-500 hover:bg-gray-50"}`;
    btn.innerText = `${y}년`;
    btn.onclick = (e) => {
      e.stopPropagation();
      currentYear = y;
      document.getElementById("floatingYearMonth").innerText = `${currentYear}년 ${currentMonth + 1}월`;
      renderMiniPickerLists();
      resetCalendarTo(currentYear, currentMonth);
    };
    yList.appendChild(btn);
    if (active) setTimeout(() => btn.scrollIntoView({ block: "center" }), 10);
  }
  for (let m = 0; m < 12; m++) {
    const btn = document.createElement("button");
    const active = m === currentMonth;
    btn.className = `w-full py-1.5 text-xs rounded-md font-bold snap-center transition ${active ? "bg-indigo-50 text-indigo-600" : "text-gray-500 hover:bg-gray-50"}`;
    btn.innerText = `${m + 1}월`;
    btn.onclick = (e) => {
      e.stopPropagation();
      toggleMonthPicker();
      currentMonth = m;
      document.getElementById("floatingYearMonth").innerText = `${currentYear}년 ${currentMonth + 1}월`;
      resetCalendarTo(currentYear, currentMonth);
    };
    mList.appendChild(btn);
    if (active) setTimeout(() => btn.scrollIntoView({ block: "center" }), 10);
  }
}

async function resetCalendarTo(year, month) {
  renderStartDate = new Date(year - 2, 0, 1);
  renderStartDate.setDate(renderStartDate.getDate() - renderStartDate.getDay());
  renderEndDate = new Date(year + 2, 11, 31);
  renderEndDate.setDate(renderEndDate.getDate() + (6 - renderEndDate.getDay()));

  const holidays = await fetchGoogleHolidays(renderStartDate, renderEndDate);
  leavesCache = [...dbLeavesCache, ...holidays];
  document.getElementById("calendar").innerHTML = generateCellsHTML(renderStartDate, renderEndDate);
  renderEvents();
}

function generateCellsHTML(start, end) {
  let html = "";
  let iter = new Date(start);
  const todayStr = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  
  const isClickable = ["reviewer", "officer", "approver", "superadmin"].includes(currentUserRole) && currentCalendarMode !== "personal";

  while (iter <= end) {
    html += `<div class="week-row col-span-7 relative min-h-[120px] transition-all duration-300 border-b border-gray-100 flex w-full">`;
    let bgHtml = `<div class="absolute inset-0 grid grid-cols-7 w-full h-full">`;
    let daysInWeek = [];
    for (let i = 0; i < 7; i++) {
      const y = iter.getFullYear(), m = iter.getMonth(), d = iter.getDate();
      const fullDateStr = formatDate(y, m, d);
      daysInWeek.push(fullDateStr);
      const isToday = fullDateStr === todayStr;
      const isFirst = d === 1;
      const dateColor = isToday ? "bg-indigo-600 text-white px-2 py-0.5 rounded-full font-black inline-block" : i === 0 ? "text-red-500 date-text" : i === 6 ? "text-blue-500 date-text" : "text-gray-700 date-text";
      
      // 🔥 [分離] 只有點擊格子空白處，才會打開抽屜面板
      const clickAction = isClickable ? `onclick="openBottomSheet('${fullDateStr}')"` : "";
      const hoverClass = isClickable ? "hover:bg-indigo-50/50 cursor-pointer" : "cursor-default";

      bgHtml += `<div class="day-cell border-r border-gray-100 flex flex-col p-1.5 relative transition-colors duration-300 ${hoverClass}" data-date="${fullDateStr}" ${clickAction}>
        <div class="flex justify-between items-start z-0">
          <span class="holiday-name text-[10px] text-red-500 font-bold truncate max-w-[70%] drop-shadow-sm mt-0.5"></span>
          <span class="text-xs font-bold transition-colors ${dateColor} ${isFirst && !isToday ? "text-indigo-600 text-sm" : ""}">${isFirst ? `${m + 1}월 ${d}일` : d}</span>
        </div>
      </div>`;
      iter.setDate(iter.getDate() + 1);
    }
    bgHtml += `</div>`;
    html += bgHtml + `<div class="event-layer absolute top-8 left-0 right-0 bottom-1 pointer-events-none flex flex-col gap-[4px] z-10" data-week-start="${daysInWeek[0]}"></div></div>`;
  }
  return html;
}

function getDatesInRange(startStr, endStr) {
  const dates = [];
  let current = new Date(startStr.split("T")[0]);
  const end = new Date(endStr.split("T")[0]);
  while (current <= end) {
    dates.push(formatDate(current.getFullYear(), current.getMonth(), current.getDate()));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function updateVisualFocus(focusYear, focusMonth) {
  const titleEl = document.getElementById("floatingYearMonth");
  if (titleEl) titleEl.innerText = `${focusYear}년 ${focusMonth + 1}월`;
  document.querySelectorAll(".day-cell").forEach((cell) => {
    const [y, m] = cell.dataset.date.split("-");
    if (parseInt(y, 10) === focusYear && parseInt(m, 10) === focusMonth + 1) {
      cell.classList.remove("opacity-30", "bg-gray-50/50", "grayscale-[30%]");
      cell.classList.add("opacity-100", "bg-white");
    } else {
      cell.classList.remove("opacity-100", "bg-white");
      cell.classList.add("opacity-30", "bg-gray-50/50", "grayscale-[30%]");
    }
  });
}

function setupScrollObserver() {
  const container = document.getElementById("calendar");
  container.addEventListener("scroll", async () => {
    const rect = container.getBoundingClientRect();
    const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 3);
    const cell = el ? el.closest(".day-cell") : null;
    if (cell) {
      const [y, m] = cell.dataset.date.split("-");
      if (parseInt(y, 10) !== currentYear || parseInt(m, 10) - 1 !== currentMonth) {
        currentYear = parseInt(y, 10);
        currentMonth = parseInt(m, 10) - 1;
        updateVisualFocus(currentYear, currentMonth);
      }
    }
  }, { passive: true });
}

async function scrollToMonth(year, month, smooth = true) {
  const targetStr = formatDate(year, month, 1);
  let targetCell = document.querySelector(`.day-cell[data-date="${targetStr}"]`);
  if (!targetCell) {
    await resetCalendarTo(year, month);
    targetCell = document.querySelector(`.day-cell[data-date="${targetStr}"]`);
  }
  if (targetCell) {
    const calendar = document.getElementById("calendar");
    const targetRow = targetCell.closest(".week-row") || targetCell;
    calendar.scrollTo({ top: Math.max(0, targetRow.offsetTop - 60), behavior: smooth ? "smooth" : "instant" });
    currentYear = year;
    currentMonth = month;
    updateVisualFocus(year, month);
  }
}

function renderEvents() {
  document.querySelectorAll(".event-layer").forEach((el) => (el.innerHTML = ""));
  document.querySelectorAll(".holiday-name").forEach((el) => (el.innerText = ""));

  let displayLeaves = leavesCache.filter((leave) => {
    if (leave.isHoliday) return true;
    if (currentCalendarMode === "personal") return true; 
    if (currentCalendarMode === "team-long") return leave.type === "휴가"; 
    if (currentCalendarMode === "team-short") return leave.type === "외출" || leave.type === "외박"; 
    return true;
  });

  const sortedLeaves = [...displayLeaves].sort((a, b) => {
    if (a.isHoliday && !b.isHoliday) return -1;
    if (!a.isHoliday && b.isHoliday) return 1;
    
    if (!a.isWaitlisted && b.isWaitlisted) return -1;
    if (a.isWaitlisted && !b.isWaitlisted) return 1;

    const startA = new Date(a.startDate).getTime();
    const startB = new Date(b.startDate).getTime();
    if (startA !== startB) return startA - startB;
    return (new Date(b.endDate).getTime() - startA) - (new Date(a.endDate).getTime() - startB);
  });

  const levelMap = {};
  sortedLeaves.forEach((leave) => {
    if (leave.isHoliday) {
      const cell = document.querySelector(`.day-cell[data-date="${leave.startDate}"]`);
      if (cell) {
        const nameEl = cell.querySelector(".holiday-name");
        if (nameEl) nameEl.innerText = leave.title;
        cell.classList.add("bg-red-50/20");
        const dateNum = cell.querySelector(".date-text");
        if (dateNum) {
          dateNum.classList.remove("text-gray-700", "text-blue-500");
          if (!dateNum.classList.contains("bg-indigo-600")) dateNum.classList.add("text-red-500");
        }
      }
      return;
    }
    const datesStr = getDatesInRange(leave.startDate, leave.endDate);
    let targetLevel = 0, found = false;
    while (!found) {
      found = true;
      for (const dateStr of datesStr) {
        if (!levelMap[dateStr]) levelMap[dateStr] = [];
        if (levelMap[dateStr][targetLevel]) { found = false; break; }
      }
      if (!found) targetLevel++;
    }
    for (const dateStr of datesStr) levelMap[dateStr][targetLevel] = leave;
  });

  const weekRows = document.querySelectorAll(".week-row");
  weekRows.forEach((weekRow) => {
    const fgLayer = weekRow.querySelector(".event-layer");
    const days = Array.from(weekRow.querySelectorAll(".day-cell")).map((cell) => cell.dataset.date);
    let maxLevel = -1;
    days.forEach((d) => {
      if (levelMap[d]) maxLevel = Math.max(maxLevel, levelMap[d].length - 1);
    });

    if (maxLevel >= 0) {
      const requiredHeight = (maxLevel + 1) * 26 + 40;
      if (requiredHeight > 120) weekRow.style.minHeight = `${requiredHeight}px`;
    }

    for (let level = 0; level <= maxLevel; level++) {
      const levelRow = document.createElement("div");
      levelRow.className = "relative w-full h-[22px]";
      let currentLeave = null, startIndex = -1, span = 0;

      const drawBar = (leave, startIdx, sp) => {
        const bar = document.createElement("div");
        const isGlobalStart = leave.startDate.split("T")[0] === days[startIdx];
        const isGlobalEnd = leave.endDate.split("T")[0] === days[startIdx + sp - 1];
        
        bar.className = `absolute top-0 h-[22px] pointer-events-auto cursor-pointer transition-all duration-200 z-10 px-1.5 flex items-center text-[11px] font-bold text-white truncate shadow-sm leave-bar-${leave._id}`;
        bar.style.left = `calc(100% / 7 * ${startIdx})`;
        bar.style.width = `calc((100% / 7 * ${sp}) - 6px)`;
        bar.style.marginLeft = "3px";
        if (isGlobalStart && isGlobalEnd) bar.style.borderRadius = "4px";
        else if (isGlobalStart) bar.style.borderRadius = "4px 0 0 4px";
        else if (isGlobalEnd) bar.style.borderRadius = "0 4px 4px 0";

        let sText = {
          PENDING_REVIEW: "(검토대기)",
          PENDING_APPROVAL: "(승인대기)",
          REJECTED_REVIEW: "(검토거절)",
          REJECTED_APPROVAL: "(승인거절)",
          APPROVED: "",
          CANCEL_REQ_REVIEW: "(취소대기)",
          CANCEL_REQ_APPROVAL: "(취소대기)",
          CANCEL_APPROVED: "(취소됨)",
        }[leave.status] || "";

        if (leave.isWaitlisted) sText = "[후보] " + sText;
        if (leave.isManualOverride) sText = "🔒 " + sText;

        const displayName = currentCalendarMode !== "personal" 
          ? `${leave.userId?.name || ""} ${sText}` 
          : `[${leave.type || "휴가"}] ${leave.reason || ""} ${sText}`;
          
        bar.innerText = isGlobalStart || startIdx === 0 ? displayName : "";
        const fixedColor = getLeaveColor(leave.reason, leave.type);

      if (leave.status.includes("REJECTED") || leave.status === "CANCEL_APPROVED") {
          bar.style.backgroundColor = "rgba(156, 163, 175, 0.4)";
          bar.style.border = "1px dashed rgba(156, 163, 175, 0.8)";
          bar.style.color = "#4b5563";
          
          bar.onclick = async (e) => { 
            e.stopPropagation(); 
            hideProTooltip(); 
            
            // 🔥 [新增] 1. 點擊瞬間，強制關閉小鈴鐺選單！還給勇士乾淨的視野
            const dropdown = document.getElementById("notificationDropdown");
            if (dropdown) dropdown.classList.add("hidden");

            // 2. [瞬間刪除月曆長條] 平滑淡出
            bar.style.transition = "all 0.3s ease";
            bar.style.opacity = "0";
            bar.style.transform = "scale(0.9)";
            
            // 3. [瞬間刪除鈴鐺通知]
            const notiEl = document.getElementById(`noti-${leave._id}`);
            if (notiEl) notiEl.remove();

            // 🔥 [新增] 4. 樂觀更新紅點：檢查如果刪掉後，鈴鐺裡沒通知了，瞬間把紅點藏起來！
            const notificationList = document.getElementById("notificationList");
            const badge = document.getElementById("notificationBadge");
            if (notificationList && badge && notificationList.children.length === 0) {
              badge.classList.add("hidden");
            }

            try {
              // 5. 呼叫後端確認已讀並隱藏
              await fetch(`/leaves/${leave._id}/confirm-reject`, {
                method: "PUT",
                headers: { Authorization: `Bearer ${currentToken}` }
              });
              
              // 6. 背景重整小鈴鐺，確保伺服器與畫面資料 100% 同步

              setTimeout(() => {
                if (typeof window.fetchUserInfoAndNotifications === "function") {
                  window.fetchUserInfoAndNotifications();
                }
              }, 500);
            } catch(err) { 
              console.error("Confirm Reject Error:", err); 
            }

            // 7. 0.3秒後無縫重繪月曆
            setTimeout(() => refreshCalendarData(), 300); 
          };
          
        } else if (leave.isWaitlisted) {
          bar.style.backgroundColor = "rgba(249, 115, 22, 0.15)";
          bar.style.border = "1px dashed #ea580c";
          bar.style.color = "#c2410c";
        } else if (leave.status.includes("CANCEL_REQ")) {
          bar.style.backgroundColor = "#f97316";
          bar.style.opacity = "0.8";
        } else if (leave.status === "PENDING_REVIEW") {
          bar.style.backgroundColor = fixedColor;
          bar.style.opacity = "0.6";
        } else {
          bar.style.backgroundColor = fixedColor;
          bar.style.opacity = "1";
        }

        // 下方的 tooltip 與一般點擊導航邏輯維持原樣，不需要動！
        if (!leave.status.includes("REJECTED") && leave.status !== "CANCEL_APPROVED") {
          bar.addEventListener("mouseenter", (e) => {
            highlightLeave(leave._id);
            showProTooltip(e, `[${leave.type}] ${leave.userId?.name || ""} ${sText}`, `${leave.startDate.split("T")[0]} ~ ${leave.endDate.split("T")[0]}`, leave.reason || "사유 없음", leave.isWaitlisted ? "#f97316" : fixedColor);
          });
          bar.addEventListener("mousemove", moveProTooltip);
          bar.addEventListener("mouseleave", () => { unhighlightLeave(leave._id); hideProTooltip(); });
          
          bar.onclick = (e) => {
            e.stopPropagation();
            hideProTooltip();
            
            // 🔥 [分離] 只要點擊長條本身，直接導航去審核
            if (["reviewer", "officer", "approver", "superadmin"].includes(currentUserRole)) {
              if (leave.status === "PENDING_REVIEW" || leave.status === "CANCEL_REQ_REVIEW") {
                window.location.href = `review.html?id=${leave._id}`;
                return;
              } else if (leave.status === "PENDING_APPROVAL" || leave.status === "CANCEL_REQ_APPROVAL") {
                window.location.href = `approve.html?id=${leave._id}`;
                return;
              }
            }
            
            // 如果是勇士點自己的長條 (或審核已完成)，則維持原有的取消功能
            if (["PENDING_REVIEW", "PENDING_APPROVAL", "APPROVED"].includes(leave.status)) {
              if (confirm(`일정을 취소/삭제하시겠습니까?\n사유: ${leave.reason}`)) cancelLeave(leave._id);
            }
          };
        }
        levelRow.appendChild(bar);
      };

      for (let i = 0; i < 7; i++) {
        const d = days[i];
        const leave = levelMap[d] ? levelMap[d][level] : null;
        if (leave !== currentLeave) {
          if (currentLeave) drawBar(currentLeave, startIndex, span);
          currentLeave = leave;
          if (currentLeave) { startIndex = i; span = 1; }
        } else if (currentLeave) {
          span++;
        }
      }
      if (currentLeave) drawBar(currentLeave, startIndex, span);
      fgLayer.appendChild(levelRow);
    }
  });
}

function setupDragSelection() {
  const calendar = document.getElementById("calendar");
  calendar.addEventListener("dragstart", (e) => e.preventDefault());
  calendar.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest('[class*="leave-bar"]') || currentCalendarMode !== "personal") return;
    const cell = e.target.closest(".day-cell");
    if (!cell) return;
    isDragging = true;
    dragStartStr = cell.dataset.date;
    dragEndStr = dragStartStr;
    document.body.style.userSelect = "none";
    updateSelectionVisuals();
  });
  calendar.addEventListener("mouseover", (e) => {
    if (!isDragging) return;
    const cell = e.target.closest(".day-cell");
    if (!cell) return;
    if (dragEndStr !== cell.dataset.date) {
      dragEndStr = cell.dataset.date;
      updateSelectionVisuals();
    }
  });
  window.addEventListener("mouseup", async (e) => {
    if (!isDragging) return;
    isDragging = false;
    document.body.style.userSelect = "";
    if (dragStartStr && dragEndStr) {
      const d1 = new Date(dragStartStr), d2 = new Date(dragEndStr);
      const start = d1 < d2 ? d1 : d2, end = d1 < d2 ? d2 : d1;
      document.getElementById("reqStartDate").value = formatDate(start.getFullYear(), start.getMonth(), start.getDate());
      document.getElementById("reqEndDate").value = formatDate(end.getFullYear(), end.getMonth(), end.getDate());
      calculateReqDays();
      await openModal("requestModal");
    }
    clearSelectionVisuals();
  });
}

function updateSelectionVisuals() {
  clearSelectionVisuals();
  if (!dragStartStr || !dragEndStr) return;
  const d1 = new Date(dragStartStr), d2 = new Date(dragEndStr);
  const start = d1 < d2 ? d1 : d2, end = d1 < d2 ? d2 : d1;
  document.querySelectorAll(".day-cell").forEach((cell) => {
    const cellDate = new Date(cell.dataset.date);
    if (cellDate >= start && cellDate <= end) cell.classList.add("bg-indigo-100/50", "shadow-[inset_0_0_0_2px_#818cf8]", "z-20");
  });
}
function clearSelectionVisuals() {
  document.querySelectorAll(".day-cell").forEach((cell) => cell.classList.remove("bg-indigo-100/50", "shadow-[inset_0_0_0_2px_#818cf8]", "z-20"));
}

async function fetchLeavesFromDB() {
  const endpoint = currentCalendarMode === "personal" ? "/leaves/my" : "/leaves/all";
  const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${currentToken}` } });
  dbLeavesCache = (await res.json()).leaves || [];
}

async function fetchGoogleHolidays(start, end) {
  try {
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(KOREA_HOLIDAY_CALENDAR_ID)}/events?key=${GOOGLE_API_KEY}&timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`);
    return ((await res.json()).items || []).map((ev) => ({
      _id: "hol-" + ev.id, type: "holiday", title: ev.summary, startDate: ev.start.date, endDate: ev.start.date, isHoliday: true, userId: { name: "공휴일" },
    }));
  } catch { return []; }
}

function prevMonth() { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } scrollToMonth(currentYear, currentMonth, true); }
function nextMonth() { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } scrollToMonth(currentYear, currentMonth, true); }
function goToCurrentMonth() { const now = new Date(); currentYear = now.getFullYear(); currentMonth = now.getMonth(); scrollToMonth(currentYear, currentMonth, true); }

async function cancelLeave(id) {
  try {
    const res = await fetch(`/leaves/${id}`, { method: "DELETE", headers: { Authorization: "Bearer " + currentToken } });
    const data = await res.json();
    if (data.success) { alert(data.message); await refreshCalendarData(); } else { alert(data.error || "오류가 발생했습니다."); }
  } catch (err) {}
}

function formatDate(y, m, d) { const date = new Date(y, m, d, 12, 0, 0); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

function getLeaveColor(reason, type) {
  const palette = { 연가: "#3b82f6", 포상: "#1d4ed8", 위로: "#0ea5e9", 보상: "#0284c7", 기타: "#64748b", 정기외박: "#8b5cf6", 특별외박: "#6d28d9", 외박: "#7c3aed", 평일정기외출: "#10b981", 주말정기외출: "#059669", 평일특별외출: "#14b8a6", 주말특별외출: "#0f766e", 외출: "#10b981" };
  if (reason) { for (const key in palette) { if (reason.includes(key)) return palette[key]; } }
  if (type) { if (type.includes("외박")) return palette["외박"]; if (type.includes("외출")) return palette["외출"]; }
  return palette["연가"];
}

function highlightLeave(id) { document.querySelectorAll(`.leave-bar-${id}`).forEach((el) => { el.style.filter = "brightness(1.15)"; el.style.zIndex = "50"; }); }
function unhighlightLeave(id) { document.querySelectorAll(`.leave-bar-${id}`).forEach((el) => { el.style.filter = "none"; el.style.zIndex = "10"; }); }

// ==========================================
// 勇士自主登錄、讀取假單與送出申請的靈魂函數
// ==========================================

async function submitGrant() {
  const mainCat = document.getElementById("grantMainCategory").value;
  const type = mainCat === "휴가" ? document.getElementById("grantSubType").value : mainCat;
  const totalCount = document.getElementById("grantDays").value;
  const reason = document.getElementById("grantReason").value;
  if (!reason) return alert("심의 사유를 입력해 주세요.");

  const payload = {
    type: type,
    totalCount: Number(totalCount),
    reason: reason
  };

  try {
    const res = await fetch("/leave-slots", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": "Bearer " + currentToken 
      },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (result.error) return alert("오류 발생: " + result.error);
    alert("휴가가 성공적으로 등록되었습니다.");
    closeModal("grantModal");
    await loadMySlots(); 
  } catch (err) {
    alert("서버 오류가 발생했습니다.");
  }
}

async function loadMySlots() {
  try {
    const res = await fetch(`/leave-slots/me`, {
      headers: { Authorization: "Bearer " + currentToken },
    });
    const data = await res.json();
    myAvailableSlots = data.slots || [];
    currentUsedSlots = [];
    calculateReqDays();
  } catch (err) {}
}

function renderSlotList() {
  const listEl = document.getElementById("reqSlotList");
  const remainsText = document.getElementById("totalRemainsText");
  if (!listEl) return;

  if (myAvailableSlots.length === 0) {
    listEl.innerHTML = '<div class="text-sm text-gray-400 text-center py-6">사용 가능한 휴가가 없습니다. <br><span class="text-xs">(먼저 [휴가 등록]을 하거나 다시 로그인해주세요)</span></div>';
    if (remainsText) remainsText.innerText = "총 0일";
    return;
  }

  const startDate = document.getElementById("reqStartDate").value;
  const endDate = document.getElementById("reqEndDate").value;

  let hasWeekday = false;
  let hasWeekendOrHoliday = false;

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const holidays = leavesCache.filter((l) => l.isHoliday).map((l) => l.startDate.split("T")[0]);
    let iter = new Date(start);
    while (iter <= end) {
      const dStr = formatDate(iter.getFullYear(), iter.getMonth(), iter.getDate());
      const isWeekend = iter.getDay() === 0 || iter.getDay() === 6;
      if (isWeekend || holidays.includes(dStr)) hasWeekendOrHoliday = true;
      else hasWeekday = true;
      iter.setDate(iter.getDate() + 1);
    }
  }

  let totalAvailable = 0;
  let hasVisibleSlots = false;
  const groupedSlots = { 휴가: [], 외박: [], 외출: [] };

  myAvailableSlots.forEach((s) => {
    const isWeekendOnly = s.type === "외박" || s.reason.includes("주말") || s.reason.includes("정기외박");
    const isWeekdayOnly = s.reason.includes("평일");

    if (startDate && endDate) {
      if (isWeekendOnly && hasWeekday) return;
      if (isWeekdayOnly && hasWeekendOrHoliday) return;
    }

    hasVisibleSlots = true;
    totalAvailable += s.remains;
    const usedObj = currentUsedSlots.find((u) => u.slotId === s._id);
    const qty = usedObj ? usedObj.qty : 0;
    const isUsed = qty > 0;

    let typeTag = "휴가";
    if (s.type === "외박" || s.reason.includes("외박")) typeTag = "외박";
    else if (s.type === "외출" || s.reason.includes("외출")) typeTag = "외출";

    const itemHtml = `
      <div class="flex items-center justify-between p-3 rounded-xl border ${isUsed ? "border-indigo-400 bg-indigo-50/40" : "border-gray-200 bg-white"} shadow-sm transition-all mb-2">
        <div class="flex-1 min-w-0 pr-2">
          <p class="text-sm font-bold text-gray-800 truncate">[${typeTag}] ${s.reason}</p>
          <p class="text-[11px] text-gray-500 font-medium">잔여 ${s.remains}일</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button onclick="changeManualQty('${s._id}', -1)" class="w-6 h-6 border rounded border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold transition">-</button>
          <span class="w-5 text-center font-bold text-indigo-700">${qty}</span>
          <button onclick="changeManualQty('${s._id}', 1)" class="w-6 h-6 border rounded border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold transition">+</button>
        </div>
      </div>`;

    groupedSlots[typeTag].push(itemHtml);
  });

  let finalHtml = "";
  if (!hasVisibleSlots && startDate && endDate) {
    finalHtml = '<div class="text-sm text-red-500 text-center py-6 font-bold"><i class="fa-solid fa-triangle-exclamation mb-2 text-xl block"></i>선택하신 날짜(평일/주말)에 사용할 수 있는 휴가가 없습니다.</div>';
  } else {
    ["휴가", "외박", "외출"].forEach((cat) => {
      if (groupedSlots[cat].length > 0) {
        finalHtml += `<div class="text-xs font-black text-indigo-500 mb-2 mt-4 px-1 border-b border-indigo-100 pb-1 flex items-center"><i class="fa-solid fa-layer-group mr-1.5"></i>${cat} 목록</div>`;
        finalHtml += groupedSlots[cat].join("");
      }
    });
  }

  listEl.innerHTML = finalHtml;
  if (remainsText) remainsText.innerText = `총 ${totalAvailable}일`;
}

function changeManualQty(slotId, delta) {
  const startDate = document.getElementById("reqStartDate").value;
  const endDate = document.getElementById("reqEndDate").value;
  let diffDays = 0;
  if (startDate && endDate)
    diffDays = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;

  if (diffDays <= 0) {
    alert("먼저 올바른 출발일과 복귀일을 설정해주세요.");
    return;
  }

  const slot = myAvailableSlots.find((s) => s._id === slotId);
  let usedObj = currentUsedSlots.find((u) => u.slotId === slotId);
  if (!usedObj) {
    usedObj = { slotId, qty: 0 };
    currentUsedSlots.push(usedObj);
  }

  const currentTotal = currentUsedSlots.reduce((sum, u) => sum + u.qty, 0);
  if (delta > 0 && currentTotal >= diffDays) {
    alert(`신청 일수(${diffDays}일)를 초과할 수 없습니다.`);
    return;
  }

  let newQty = usedObj.qty + delta;
  if (newQty < 0) newQty = 0;
  if (newQty > slot.remains) newQty = slot.remains;
  usedObj.qty = newQty;
  currentUsedSlots = currentUsedSlots.filter((u) => u.qty > 0);

  renderSlotList();

  const calcText = document.getElementById("daysCalcText");
  const calcBox = document.getElementById("daysCalcBox");
  const totalAssigned = currentUsedSlots.reduce((sum, s) => sum + s.qty, 0);
  if (calcText) {
    if (totalAssigned < diffDays) {
      calcText.innerHTML = `<span class="text-red-500 text-sm">선택: ${totalAssigned}일 / 필요: ${diffDays}일</span>`;
      if (calcBox) calcBox.className = "bg-red-50 border border-red-200 rounded-xl p-3.5 flex justify-between items-center transition-colors";
    } else {
      calcText.innerHTML = `<span class="text-indigo-600 font-bold text-sm">일치완료 (총 ${diffDays}일)</span>`;
      if (calcBox) calcBox.className = "bg-indigo-50 border border-indigo-200 rounded-xl p-3.5 flex justify-between items-center transition-colors";
    }
  }
}

function calculateReqDays() {
  currentUsedSlots = [];

  const startDate = document.getElementById("reqStartDate").value;
  const endDate = document.getElementById("reqEndDate").value;
  let diffDays = 0;
  if (startDate && endDate)
    diffDays = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;

  renderSlotList();

  const calcBox = document.getElementById("daysCalcBox");
  const calcText = document.getElementById("daysCalcText");

  if (!startDate || !endDate || diffDays <= 0) {
    if (calcBox) calcBox.classList.add("hidden");
    return;
  }

  if (calcBox) calcBox.classList.remove("hidden");
  if (calcText) {
    calcText.innerHTML = `<span class="text-red-500 text-sm">선택: 0일 / 필요: ${diffDays}일</span>`;
    calcBox.className = "bg-red-50 border border-red-200 rounded-xl p-3.5 flex justify-between items-center transition-colors";
  }
}

async function submitRequest() {
  const startDate = document.getElementById("reqStartDate").value;
  const endDate = document.getElementById("reqEndDate").value;
  const destination = document.getElementById("reqDestination").value;
  const contact = document.getElementById("reqContact").value;
  const reason = document.getElementById("reqReason").value;

  if (!startDate || !endDate || !destination || !contact) return alert("필수 항목 누락");

  const diffDays = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
  const totalAllocated = currentUsedSlots.reduce((sum, slot) => sum + slot.qty, 0);
  if (totalAllocated !== diffDays) return alert("선택한 휴가와 일정이 일치하지 않습니다.");

  const start = new Date(startDate);
  const end = new Date(endDate);
  const holidays = leavesCache.filter((l) => l.isHoliday).map((l) => l.startDate.split("T")[0]);
  let hasWeekday = false;
  let hasWeekendOrHoliday = false;

  let iter = new Date(start);
  while (iter <= end) {
    const dStr = formatDate(iter.getFullYear(), iter.getMonth(), iter.getDate());
    const isWeekend = iter.getDay() === 0 || iter.getDay() === 6;
    if (isWeekend || holidays.includes(dStr)) hasWeekendOrHoliday = true;
    else hasWeekday = true;
    iter.setDate(iter.getDate() + 1);
  }

  for (const us of currentUsedSlots) {
    const slot = myAvailableSlots.find((s) => s._id === us.slotId);
    if (!slot) continue;
    const isWeekendOnly = slot.reason.includes("주말") || slot.type === "외박" || slot.reason.includes("특별외박") || slot.reason.includes("정기외박");
    const isWeekdayOnly = slot.reason.includes("평일");

    if (isWeekendOnly && hasWeekday) return alert(`[${slot.type}] ${slot.reason} 은(는) 주말 및 공휴일에만 사용할 수 있습니다. (평일 포함 불가)`);
    if (isWeekdayOnly && hasWeekendOrHoliday) return alert(`[${slot.type}] ${slot.reason} 은(는) 평일에만 사용할 수 있습니다. (주말/공휴일 포함 불가)`);
  }

  const formData = new FormData();
  formData.append("startDate", startDate);
  formData.append("endDate", endDate);
  formData.append("destination", destination);
  formData.append("emergencyContact", contact);
  formData.append("reason", reason);
  formData.append("usedSlots", JSON.stringify(currentUsedSlots));

  const fileInput = document.getElementById("reqFile");
  if (fileInput && fileInput.files && fileInput.files.length > 0) {
    if (fileInput.files.length > 5) return alert("증빙 서류는 최대 5개까지만 업로드 가능합니다.");
    for (let i = 0; i < fileInput.files.length; i++) {
      formData.append("evidenceFiles", fileInput.files[i]);
    }
  }

  try {
    const res = await fetch("/leaves", {
      method: "POST",
      headers: { Authorization: "Bearer " + currentToken },
      body: formData,
    });
    const result = await res.json();
    if (result.error) return alert(result.error);
    closeModal("requestModal");
    await refreshCalendarData();
    alert("출타 신청서가 성공적으로 제출되었습니다.");
  } catch (err) {
    alert("서버와 통신 중 오류가 발생했습니다.");
  }
}

// ==========================================
// 🔥 檢討者專用：底部抽屜選單互動邏輯 (支援 Drag & Drop)
// ==========================================
function openBottomSheet(dateStr) {
  const targetDate = new Date(dateStr);
  const dayLeaves = dbLeavesCache.filter(l => {
    const sDate = new Date(l.startDate.split("T")[0]);
    const eDate = new Date(l.endDate.split("T")[0]);
    if (targetDate < sDate || targetDate > eDate) return false; 
    if (l.status.includes("CANCELLED") || l.status.includes("REJECTED")) return false;
    
    if (currentCalendarMode === "team-long" && l.type !== "휴가") return false;
    if (currentCalendarMode === "team-short" && l.type !== "외출" && l.type !== "외박") return false;
    return true;
  });

  const approvedLeaves = dayLeaves.filter(l => !l.isWaitlisted);
  const waitlistedLeaves = dayLeaves.filter(l => l.isWaitlisted);

  const m = targetDate.getMonth() + 1;
  const d = targetDate.getDate();
  document.getElementById("bsDateTitle").innerText = `${m}월 ${d}일 출타 현황`;
  
  const appContainer = document.getElementById("bsApprovedList");
  appContainer.innerHTML = approvedLeaves.length === 0 ? `<div class="text-xs text-gray-400 text-center py-2">승인 대상이 없습니다.</div>` : "";
  
  approvedLeaves.forEach(l => {
    // 🔥 [修復核心] 如果已經最終核准，就不給拖曳屬性，圖示換成鎖頭！
    const isApproved = l.status === "APPROVED";
    const dragAttrs = isApproved ? "" : `draggable="true" ondragstart="handleDragStart(event, '${l._id}', '${l.userId?.name}')" ondragend="handleDragEnd(event)" ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${l._id}', '${l.userId?.name}')"`;
    const gripIcon = isApproved ? `<i class="fa-solid fa-lock text-gray-200 mr-3 text-lg" title="최종 승인됨"></i>` : `<i class="fa-solid fa-grip-lines text-gray-300 mr-3 text-lg cursor-grab active:cursor-grabbing"></i>`;
    const cursorClass = isApproved ? "cursor-default" : "cursor-move hover:shadow-md";

    appContainer.innerHTML += `
      <div ${dragAttrs} class="bg-white p-3 rounded-xl border ${l.isManualOverride ? 'border-indigo-300 shadow-md' : 'border-gray-200'} flex justify-between items-center transition ${cursorClass}">
        <div class="flex items-center min-w-0 pr-2">
          ${gripIcon}
          <div class="truncate">
            <p class="text-[13px] font-bold text-gray-800 truncate">${l.isManualOverride ? '🔒 ' : ''}${l.userId?.name || '알 수 없음'} <span class="text-[10px] text-gray-500 font-normal">(${l.userId?.rank || ''})</span></p>
            <p class="text-[11px] text-gray-500 mt-0.5 truncate">${l.reason || ''} ${isApproved ? '<span class="text-indigo-500 font-bold">(최종승인)</span>' : ''}</p>
          </div>
        </div>
        <button onclick="toggleWaitlistStatus('${l._id}')" class="shrink-0 text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition shadow-sm" title="보장 해제 (강제 내리기)">⬇️ 내리기</button>
      </div>
    `;
  });

  const waitContainer = document.getElementById("bsWaitlistList");
  waitContainer.innerHTML = waitlistedLeaves.length === 0 ? `<div class="text-xs text-gray-400 text-center py-2">후보 인원이 없습니다.</div>` : "";
  
  waitlistedLeaves.forEach(l => {
    const dragAttrs = `draggable="true" ondragstart="handleDragStart(event, '${l._id}', '${l.userId?.name}')" ondragend="handleDragEnd(event)" ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${l._id}', '${l.userId?.name}')"`;
    waitContainer.innerHTML += `
      <div ${dragAttrs} class="bg-gray-50 p-3 rounded-xl border border-dashed border-orange-300 flex justify-between items-center opacity-90 cursor-move hover:opacity-100 hover:shadow-md transition">
        <div class="flex items-center min-w-0 pr-2">
          <i class="fa-solid fa-grip-lines text-orange-200 mr-3 text-lg cursor-grab active:cursor-grabbing"></i>
          <div class="truncate">
            <p class="text-[13px] font-bold text-orange-800 truncate">${l.userId?.name || '알 수 없음'} <span class="text-[10px] text-gray-500 font-normal">(${l.userId?.rank || ''})</span></p>
            <p class="text-[11px] text-orange-600 mt-0.5 truncate">${l.reason || ''}</p>
          </div>
        </div>
        <button onclick="toggleWaitlistStatus('${l._id}')" class="shrink-0 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition shadow-sm" title="정규 편성으로 강제 올리기">⬆️ 올리기</button>
      </div>
    `;
  });

  document.getElementById("bottomSheetOverlay").classList.remove("hidden");
  setTimeout(() => {
    document.getElementById("bottomSheetOverlay").classList.remove("opacity-0");
    document.getElementById("bottomSheet").classList.remove("translate-y-full");
  }, 10);
}

function closeBottomSheet() {
  document.getElementById("bottomSheetOverlay").classList.add("opacity-0");
  document.getElementById("bottomSheet").classList.add("translate-y-full");
  setTimeout(() => {
    document.getElementById("bottomSheetOverlay").classList.add("hidden");
  }, 300);
}

async function toggleWaitlistStatus(leaveId) {
  alert("이 기능은 수동 개입(isManualOverride) API 연결이 필요합니다!\n(클릭된 ID: " + leaveId + ")");
}

// ==========================================
// 🔥 出島率與長官特權 API 串接 (進階可視化版)
// ==========================================
async function fetchLeaveRates() {
  if (!["reviewer", "officer", "approver", "superadmin"].includes(currentUserRole)) return;
  try {
    const res = await fetch("/leaves/rates", { headers: { Authorization: `Bearer ${currentToken}` } });
    const data = await res.json();
    if (data.success) {
      document.getElementById("rateLongInput").value = data.leaveRateLong;
      document.getElementById("rateShortInput").value = data.leaveRateShort;
      renderSpecialRates(data.specialRates); // 畫出特殊期間列表
    }
  } catch(e) {}
}

function renderSpecialRates(rates) {
  const container = document.getElementById("activeSpecialRatesContainer");
  const list = document.getElementById("specialRatesList");
  if (!rates || rates.length === 0) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  list.innerHTML = rates.map(r => `
    <li class="flex justify-between items-center bg-white border border-indigo-100 px-3 py-1.5 rounded-lg text-xs shadow-sm">
      <div class="flex items-center">
        <span class="font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded mr-2">${r.startDate} ~ ${r.endDate}</span>
        <span class="font-bold text-gray-700">${r.reason}</span>
        <span class="text-gray-500 ml-2 border-l border-gray-300 pl-2">휴가 ${r.rateLong}% / 단기 ${r.rateShort}%</span>
      </div>
      <button onclick="deleteSpecialRate('${r._id}')" class="text-red-500 hover:bg-red-50 px-2 py-1 rounded transition" title="삭제"><i class="fa-solid fa-trash-can"></i></button>
    </li>
  `).join("");
}

// 儲存基本出島率
async function updateLeaveRates() {
  const rateLong = document.getElementById("rateLongInput").value;
  const rateShort = document.getElementById("rateShortInput").value;
  if (!confirm(`기본 출타율을 변경하시겠습니까? (휴가 ${rateLong}%, 단기 ${rateShort}%)\n\n(변경 시 모든 인원의 정/후보 상태가 즉시 재계산됩니다!)`)) return;

  try {
    const res = await fetch("/leaves/rates", {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentToken}` },
      body: JSON.stringify({ leaveRateLong: rateLong, leaveRateShort: rateShort })
    });
    const data = await res.json();
    alert(data.message || data.error);
    if (data.success) await refreshCalendarData();
  } catch(e) { alert("오류가 발생했습니다."); }
}

// 新增特殊期間出島率
async function addSpecialRate() {
  const sDate = document.getElementById("specialStartDate").value;
  const eDate = document.getElementById("specialEndDate").value;
  const sReason = document.getElementById("specialReason").value;
  const rateLong = document.getElementById("specialRateLong").value || 20;
  const rateShort = document.getElementById("specialRateShort").value || 15;

  if (!sDate || !eDate || !sReason) return alert("날짜와 사유를 모두 입력해주세요.");
  if (!confirm(`[특별 기간 적용]\n${sDate} ~ ${eDate} 기간 동안 출타율을 변경하시겠습니까?\n사유: ${sReason}`)) return;

  try {
    const res = await fetch("/leaves/rates", {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentToken}` },
      body: JSON.stringify({ specialStartDate: sDate, specialEndDate: eDate, specialReason: sReason, specialRateLong: rateLong, specialRateShort: rateShort })
    });
    const data = await res.json();
    alert(data.message || data.error);
    if (data.success) {
      // 成功後清空輸入框
      document.getElementById("specialStartDate").value = "";
      document.getElementById("specialEndDate").value = "";
      document.getElementById("specialReason").value = "";
      document.getElementById("specialRateLong").value = "";
      document.getElementById("specialRateShort").value = "";
      
      // 🔥 關鍵修正：立刻去後端抓最新的列表，讓 UI 瞬間顯示/隱藏！
      await fetchLeaveRates(); 
      await refreshCalendarData(); 
    }
  } catch(e) { alert("오류가 발생했습니다."); }
}

// 刪除特殊期間出島率
async function deleteSpecialRate(rateId) {
  if(!confirm("이 특별 출타율 설정을 삭제하시겠습니까?\n(삭제 시 해당 기간은 기본 출타율 기준으로 즉시 재계산됩니다.)")) return;
  try {
    const res = await fetch(`/leaves/rates/special/${rateId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if(data.success) {
      // 🔥 關鍵修正：立刻去後端抓最新的列表，讓 UI 瞬間顯示/隱藏！
      await fetchLeaveRates(); 
      await refreshCalendarData();
    }
  } catch(e) { alert("삭제 중 오류가 발생했습니다."); }
}

// 長官手動把候補拉上來 (不佔名額特例)
async function toggleWaitlistStatus(leaveId) {
  if (!confirm("이 인원의 정규/후보 상태를 수동으로 강제 변경(고정)하시겠습니까?\n(수동 고정된 인원은 T/O를 차지하지 않습니다.)")) return;
  try {
    const res = await fetch(`/leaves/${leaveId}/manual-override`, {
      method: "PUT", headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      await refreshCalendarData(); 
      closeBottomSheet(); 
      alert(data.isManualOverride ? "해당 인원이 정규 편성으로 강제 고정(🔒) 되었습니다." : "해당 인원의 강제 고정이 해제되어 다시 점수 경쟁에 포함됩니다.");
    }
  } catch(e) { alert("수동 개입 처리 중 오류가 발생했습니다."); }
}

// ==========================================
// 🔥 抽屜面板 Drag & Drop (1換1 積分對調) 邏輯
// ==========================================
let draggedLeaveId = null;
let draggedLeaveName = null;

function handleDragStart(e, id, name) {
  if (!["reviewer", "officer", "approver", "superadmin"].includes(currentUserRole)) return;
  draggedLeaveId = id;
  draggedLeaveName = name;
  e.dataTransfer.effectAllowed = "move";
  // 讓被拖起來的那塊變半透明，視覺上更直覺
  setTimeout(() => { e.target.classList.add("opacity-50", "scale-95"); }, 0);
}

function handleDragEnd(e) {
  e.target.classList.remove("opacity-50", "scale-95");
}

function handleDragOver(e) {
  e.preventDefault(); // 允許 Drop 發生
  e.dataTransfer.dropEffect = "move";
}

async function handleDrop(e, targetId, targetName) {
  e.preventDefault();
  if (!draggedLeaveId || draggedLeaveId === targetId) return;

  if (confirm(`[순위 맞바꾸기]\n${draggedLeaveName} 인원과 ${targetName} 인원의 휴가 순위를 1:1로 맞바꾸시겠습니까?\n(점수가 서로 교환되어 즉시 재계산됩니다.)`)) {
    try {
      const res = await fetch("/leaves/swap-priority", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentToken}` },
        body: JSON.stringify({ leaveId1: draggedLeaveId, leaveId2: targetId })
      });
      const data = await res.json();
      alert(data.message || data.error);
      
      if (data.success) {
        closeBottomSheet(); // 關閉抽屜
        await refreshCalendarData(); // 重新整理月曆，長條顏色會瞬間交換！
      }
    } catch(err) {
      alert("교환 중 오류가 발생했습니다.");
    }
  }
}

// ==========================================
// 🔥 全局搜尋引擎 (Global Search & Spotlight)
// ==========================================
let globalSearchCache = null;

// 當搜尋框獲得焦點時，偷偷在背景拉取一次全軍資料 (避免每次打字都發送 API 請求)
async function initGlobalSearchData() {
  const endpoint = ["reviewer", "officer", "approver", "superadmin"].includes(currentUserRole) ? "/leaves/all" : "/leaves/my";
  try {
    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${currentToken}` } });
    const data = await res.json();
    globalSearchCache = data.leaves || [];
  } catch(e) {
    console.error("搜尋資料載入失敗", e);
  }
}

// 處理使用者打字過濾
function handleGlobalSearch(query) {
  query = query.trim().toLowerCase();
  const dropdown = document.getElementById("globalSearchDropdown");
  
  if (!query) {
    dropdown.classList.add("hidden");
    return;
  }

  if (!globalSearchCache) return; // 如果資料還沒回來就先等一下

  const results = globalSearchCache.filter(l => {
    // 排除已經取消或被拒絕的假單
    if (l.status.includes("CANCELLED") || l.status.includes("REJECTED")) return false; 
    
    // 把名字、階級、事由、假別全部串在一起搜
    const searchStr = `${l.userId?.name || ""} ${l.userId?.rank || ""} ${l.reason || ""} ${l.type || ""}`.toLowerCase();
    return searchStr.includes(query);
  });

  renderSearchResults(results);
}

// 渲染下拉選單結果
function renderSearchResults(results) {
  const dropdown = document.getElementById("globalSearchDropdown");
  const list = document.getElementById("globalSearchList");
  dropdown.classList.remove("hidden");
  
  if (results.length === 0) {
    list.innerHTML = `<div class="p-5 text-sm text-gray-400 text-center"><i class="fa-solid fa-magnifying-glass-minus block text-2xl mb-2"></i>검색 결과가 없습니다.</div>`;
    return;
  }

  list.innerHTML = results.map(l => {
    const sDate = l.startDate.split("T")[0];
    const eDate = l.endDate.split("T")[0];
    let statusBadge = l.isWaitlisted 
        ? `<span class="bg-orange-100 text-orange-600 border border-orange-200 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-tight">후보</span>` 
        : `<span class="bg-blue-100 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-tight">정규</span>`;
    
    // 點擊時觸發聚光燈導航 (executeSearchNavigation)
    return `
    <div onclick="executeSearchNavigation('${l._id}', '${l.type}', '${sDate}')" class="p-3 hover:bg-indigo-50 border-b border-gray-50 cursor-pointer transition flex flex-col gap-1">
        <div class="flex justify-between items-center">
            <span class="font-bold text-[13px] text-gray-800">[${l.type}] ${l.userId?.name || "알수없음"} <span class="text-[11px] text-gray-500 font-normal">(${l.userId?.rank || ""})</span></span>
            ${statusBadge}
        </div>
        <div class="text-[11px] text-gray-500 truncate"><i class="fa-regular fa-calendar mr-1"></i>${sDate.replace(/-/g, ".")} ~ ${eDate.replace(/-/g, ".")} | ${l.reason}</div>
    </div>`;
  }).join("");
}

// 🌟 殺手級功能：聚光燈導航特效 (加入 isSmooth 參數)
async function executeSearchNavigation(leaveId, type, startDateStr, isSmooth = true) {
  // 1. 隱藏下拉選單
  const dropdown = document.getElementById("globalSearchDropdown");
  const input = document.getElementById("globalSearchInput");
  if(dropdown) dropdown.classList.add("hidden");
  if(input) { input.value = ""; input.blur(); }

  // 2. 根據身分切換合適的月曆模式
  if (["reviewer", "officer", "approver", "superadmin"].includes(currentUserRole)) {
    // 長官：根據假別自動切換到對應的全體月曆
    const targetMode = (type === "휴가") ? "team-long" : "team-short";
    if (currentCalendarMode !== targetMode) {
      await switchCalendarMode(targetMode); 
    }
  } else {
    // 🔥 [新增] 勇士專屬：只要點擊小鈴鐺通知或搜尋，一律強制切換回「내 휴가 (我的休假)」模式！
    if (currentCalendarMode !== "personal") {
      await switchCalendarMode("personal");
    }
  }

  // 3. 🔥 滾動到目標月份 (根據 isSmooth 決定要不要有動畫)
  const targetDate = new Date(startDateStr);
  await scrollToMonth(targetDate.getFullYear(), targetDate.getMonth(), isSmooth);

  // 4. 🔥 智能追蹤雷達 (單純加上/移除 Class，依靠 CSS 實現平滑過渡)
  let attempts = 0;
  const tryHighlight = () => {
    const targetBar = document.querySelector(`.leave-bar-${leaveId}`);
    
    if (targetBar) {
      // 找到了！大家貼上標籤
      const allBars = document.querySelectorAll('[class*="leave-bar-"]');
      allBars.forEach(bar => {
        if (bar === targetBar) {
          bar.classList.add('spotlight-target'); // 放大浮出
        } else {
          bar.classList.add('spotlight-dimmed'); // 其他變暗
        }
      });

      // 3.5 秒後「平滑縮回原本大小」
      setTimeout(() => {
        allBars.forEach(bar => {
          bar.classList.remove('spotlight-target', 'spotlight-dimmed');
        });
        // ⚠️ 這裡絕對不能呼叫 renderEvents()！
        // 只要把 class 移除，CSS 就會自動平滑地把它縮回原本的大小和狀態。
      }, 1500);

    } else if (attempts < 20) {
      // 還沒畫出來，等 0.2 秒再找一次
      attempts++;
      setTimeout(tryHighlight, 200);
    }
  };

  // 啟動雷達！
  tryHighlight();
}

// 當點擊畫面空白處時，自動關閉搜尋下拉選單
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("globalSearchDropdown");
  const input = document.getElementById("globalSearchInput");
  if (dropdown && !dropdown.classList.contains("hidden")) {
    if (!dropdown.contains(e.target) && e.target !== input) {
      dropdown.classList.add("hidden");
    }
  }
});