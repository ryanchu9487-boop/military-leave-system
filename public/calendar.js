/**
 * SmartMil Unified Calendar Logic - 終極防呆、自動排備取與抽屜選單版
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
  
  // 抓取並儲存當前使用者權限
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
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
  await refreshCalendarData();
  setupScrollObserver();
  setupDragSelection();
  setTimeout(() => {
    scrollToMonth(currentYear, currentMonth, false);
  }, 50);
}

async function refreshCalendarData() {
  await fetchLeavesFromDB();
  await resetCalendarTo(currentYear, currentMonth);
  updateModeUI();
}

// 🔥 [升級] 三種月曆模式切換
async function switchCalendarMode(mode) {
  if (currentCalendarMode === mode) return;
  currentCalendarMode = mode;
  updateModeUI();
  await resetCalendarTo(currentYear, currentMonth); // 重新渲染當前畫面
}

function updateModeUI() {
  const btnPersonal = document.getElementById("btnPersonal");
  const btnTeamLong = document.getElementById("btnTeamLong");
  const btnTeamShort = document.getElementById("btnTeamShort");
  const rateControlUI = document.getElementById("rateControlUI"); // 新增

  const activeClass = "px-5 py-2 bg-white shadow-sm rounded-md text-sm font-bold text-gray-800 transition";
  const inactiveClass = "px-5 py-2 text-sm font-bold text-gray-500 hover:text-gray-800 transition";

  btnPersonal.className = currentCalendarMode === "personal" ? activeClass : inactiveClass;
  btnTeamLong.className = currentCalendarMode === "team-long" ? activeClass : inactiveClass;
  btnTeamShort.className = currentCalendarMode === "team-short" ? activeClass : inactiveClass;

  // 🔥 只有長官在看「全體月曆」時，才顯示出島率調整工具
  if (rateControlUI) {
    if (["reviewer", "officer", "approver", "superadmin"].includes(currentUserRole) && currentCalendarMode !== "personal") {
      rateControlUI.classList.remove("hidden");
      rateControlUI.classList.add("flex");
    } else {
      rateControlUI.classList.add("hidden");
      rateControlUI.classList.remove("flex");
    }
  }
}

// 批次結算 (呼叫剛剛寫好的 API)
async function batchApprovePhase1() {
  if (!confirm("현재 화면에 표시된 [정규 편성(정원 내)] 인원들을 일괄 승인/검토완료 처리하시겠습니까?\n(후보 인원은 제외됩니다)")) return;
  try {
    const res = await fetch(`/leaves/approve-all`, {
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
  pill.style.top = "42px"; // 電腦版預設高度，手機版由 CSS 覆蓋
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

// 🔥 [升級] 讓長官在全體模式下，點擊格子會叫出抽屜選單
function generateCellsHTML(start, end) {
  let html = "";
  let iter = new Date(start);
  const todayStr = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  
  // 只有長官且在全體模式下才允許點擊格子開啟抽屜
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

// 🔥 [升級] 繪製日曆物件，依照模式分流與「正取/候補」排序
function renderEvents() {
  document.querySelectorAll(".event-layer").forEach((el) => (el.innerHTML = ""));
  document.querySelectorAll(".holiday-name").forEach((el) => (el.innerText = ""));

  // 1. 根據目前模式過濾資料
  let displayLeaves = leavesCache.filter((leave) => {
    if (leave.isHoliday) return true;
    if (currentCalendarMode === "personal") return true; // 個人模式：全秀
    if (currentCalendarMode === "team-long") return leave.type === "휴가"; // 全體長假
    if (currentCalendarMode === "team-short") return leave.type === "외출" || leave.type === "외박"; // 全體短假
    return true;
  });

  // 2. 排序：國定假日最上面 -> 正取 (isWaitlisted=false) -> 候補 (isWaitlisted=true)
  const sortedLeaves = [...displayLeaves].sort((a, b) => {
    if (a.isHoliday && !b.isHoliday) return -1;
    if (!a.isHoliday && b.isHoliday) return 1;
    
    // 正取排在上面，候補排在下面
    if (!a.isWaitlisted && b.isWaitlisted) return -1;
    if (a.isWaitlisted && !b.isWaitlisted) return 1;

    // 長度與時間排序
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

        // 🔥 如果是候補，強制加上標籤
        if (leave.isWaitlisted) sText = "[후보] " + sText;
        if (leave.isManualOverride) sText = "🔒 " + sText; // 手動保底標籤

        const displayName = currentCalendarMode !== "personal" 
          ? `${leave.userId?.name || ""} ${sText}` 
          : `[${leave.type || "휴가"}] ${leave.reason || ""} ${sText}`;
          
        bar.innerText = isGlobalStart || startIdx === 0 ? displayName : "";
        const fixedColor = getLeaveColor(leave.reason, leave.type);

        // 🔥 視覺樣式分流
        if (leave.status.includes("REJECTED") || leave.status === "CANCEL_APPROVED") {
          bar.style.backgroundColor = "rgba(156, 163, 175, 0.4)";
          bar.style.border = "1px dashed rgba(156, 163, 175, 0.8)";
          bar.style.color = "#4b5563";
          bar.onclick = (e) => { e.stopPropagation(); hideProTooltip(); createShatterAnimation(bar); setTimeout(() => refreshCalendarData(), 800); };
        } else if (leave.isWaitlisted) {
          // 候補樣式：橘色虛線、微透明、橘色字體
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
            // 長官在全體模式下，點擊假單本身不會觸發取消，而是讓事件冒泡去觸發底下的 Bottom Sheet
            if (currentCalendarMode !== "personal" && ["reviewer", "officer"].includes(currentUserRole)) {
              openBottomSheet(days[startIdx]); // 自動打開那天的抽屜
              return;
            }
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
  // 後端會回傳所有的假單 (包含 isWaitlisted, priorityScore, isManualOverride)
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

function createShatterAnimation(barEl) {
  const rect = barEl.getBoundingClientRect();
  const fragmentCount = 30;
  const shardsContainer = [];
  barEl.classList.add("bar-is-shattering");
  for (let i = 0; i < fragmentCount; i++) {
    const shard = document.createElement("div"); shard.className = "shatter-fragment";
    const sW = 6 + Math.random() * 20, sH = 6 + Math.random() * 20;
    shard.style.width = `${sW}px`; shard.style.height = `${sH}px`;
    shard.style.setProperty("--fragment-bg", "#6b7280");
    const points = [`${Math.random() * 10}% ${Math.random() * 10}%`, `${90 + Math.random() * 10}% ${Math.random() * 10}%`, `${90 + Math.random() * 10}% ${90 + Math.random() * 10}%`, `${Math.random() * 10}% ${90 + Math.random() * 10}%`];
    shard.style.clipPath = `polygon(${points.join(",")})`;
    shard.style.left = `${rect.left + Math.random() * (rect.width - sW)}px`;
    shard.style.top = `${rect.top + Math.random() * (rect.height - sH)}px`;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const txMid = ((Math.random() * rect.width) / 4) * direction, tyMid = -(10 + Math.random() * 15), rotMid = direction * (30 + Math.random() * 60);
    const txEnd = Math.random() * rect.width * direction * 1.2, tyEnd = 50 + Math.random() * 80, rotEnd = direction * (180 + Math.random() * 360);
    shard.style.setProperty("--tx-mid", `${txMid}px`); shard.style.setProperty("--ty-mid", `${tyMid}px`); shard.style.setProperty("--rot-mid", `${rotMid}deg`); shard.style.setProperty("--tx-end", `${txEnd}px`); shard.style.setProperty("--ty-end", `${tyEnd}px`); shard.style.setProperty("--rot-end", `${rotEnd}deg`);
    const duration = 0.7 + Math.random() * 0.4, delay = Math.random() * 0.05;
    shard.style.animation = `fragmentShatter ${duration}s cubic-bezier(0.25, 1, 0.5, 1) ${delay}s forwards`;
    document.body.appendChild(shard); shardsContainer.push(shard);
  }
  setTimeout(() => { shardsContainer.forEach((s) => s.remove()); }, 1500);
}


// ==========================================
// 🔥 [新增] 檢討者專用：底部抽屜選單互動邏輯
// ==========================================
function openBottomSheet(dateStr) {
  // 過濾當天資料
  const targetDate = new Date(dateStr);
  
  // 依照當前月曆模式篩選
  const dayLeaves = dbLeavesCache.filter(l => {
    const sDate = new Date(l.startDate.split("T")[0]);
    const eDate = new Date(l.endDate.split("T")[0]);
    if (targetDate < sDate || targetDate > eDate) return false; // 不在這天
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
  
  // 渲染正取列表
  const appContainer = document.getElementById("bsApprovedList");
  appContainer.innerHTML = approvedLeaves.length === 0 ? `<div class="text-xs text-gray-400 text-center py-2">승인 대상이 없습니다.</div>` : "";
  approvedLeaves.forEach(l => {
    appContainer.innerHTML += `
      <div class="bg-white p-3 rounded-xl border ${l.isManualOverride ? 'border-indigo-300 shadow-sm' : 'border-gray-200'} flex justify-between items-center">
        <div>
          <p class="text-[13px] font-bold text-gray-800">${l.isManualOverride ? '🔒 ' : ''}${l.userId?.name || '알 수 없음'} <span class="text-[10px] text-gray-500 font-normal">(${l.userId?.rank || ''})</span></p>
          <p class="text-[11px] text-gray-500 mt-0.5">${l.reason || ''}</p>
        </div>
        <button onclick="toggleWaitlistStatus('${l._id}')" class="text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition" title="후보로 내리기">⬇️ 내리기</button>
      </div>
    `;
  });

  // 渲染候補列表
  const waitContainer = document.getElementById("bsWaitlistList");
  waitContainer.innerHTML = waitlistedLeaves.length === 0 ? `<div class="text-xs text-gray-400 text-center py-2">후보 인원이 없습니다.</div>` : "";
  waitlistedLeaves.forEach(l => {
    waitContainer.innerHTML += `
      <div class="bg-white p-3 rounded-xl border border-dashed border-orange-300 flex justify-between items-center opacity-80">
        <div>
          <p class="text-[13px] font-bold text-orange-800">${l.userId?.name || '알 수 없음'} <span class="text-[10px] text-gray-500 font-normal">(${l.userId?.rank || ''})</span></p>
          <p class="text-[11px] text-orange-600 mt-0.5">${l.reason || ''} (포인트: ${l.priorityScore || 0})</p>
        </div>
        <button onclick="toggleWaitlistStatus('${l._id}')" class="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition" title="정규 편성으로 강제 올리기">⬆️ 올리기</button>
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

// 模擬長官點擊 ⬆️ 或 ⬇️ 按鈕時的 API 呼叫 (目前尚未實作此 API，先做畫面提示)
async function toggleWaitlistStatus(leaveId) {
  alert("이 기능은 수동 개입(isManualOverride) API 연결이 필요합니다!\n(클릭된 ID: " + leaveId + ")");
  // 未來您可以在後端加一個 PUT /leaves/:id/manual-override 
  // 然後在這裡 fetch 呼叫，成功後執行 refreshCalendarData() 並重新打開 openBottomSheet()
}