/**
 * SmartMil Unified Calendar Logic - 終極防呆與碎裂動畫版
 */

const GOOGLE_API_KEY = "AIzaSyBDbm1GF1W0wKYXSeAoIj3F8TJbmn7wHuw";
const KOREA_HOLIDAY_CALENDAR_ID =
  "ko.south_korea#holiday@group.v.calendar.google.com";

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let renderStartDate = null;
let renderEndDate = null;
let dbLeavesCache = [];
let leavesCache = [];
let currentToken = localStorage.getItem("token") || "";

let currentCalendarMode = "personal";
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
}

async function switchCalendarMode(mode) {
  if (currentCalendarMode === mode) return;
  currentCalendarMode = mode;
  const btnPersonal = document.getElementById("btnPersonal");
  const btnTeam = document.getElementById("btnTeam");
  if (mode === "personal") {
    btnPersonal.className =
      "px-5 py-2 bg-white shadow-sm rounded-md text-sm font-bold text-gray-800 transition";
    btnTeam.className =
      "px-5 py-2 text-sm font-bold text-gray-500 hover:text-gray-800 transition";
  } else {
    btnTeam.className =
      "px-5 py-2 bg-white shadow-sm rounded-md text-sm font-bold text-gray-800 transition";
    btnPersonal.className =
      "px-5 py-2 text-sm font-bold text-gray-500 hover:text-gray-800 transition";
  }
  await refreshCalendarData();
}

function injectFloatingUI() {
  const container = document.getElementById("calendar").parentElement;
  container.classList.add("relative");
  container.style.paddingTop = "0px";
  if (document.getElementById("floatingPill")) return;

  const style = document.createElement("style");
  style.innerHTML = `
    @keyframes dynamicDrop { 0% { transform: translate(-50%, -20px) scale(0.85); opacity: 0; filter: blur(4px); } 100% { transform: translate(-50%, 0) scale(1); opacity: 1; filter: blur(0px); } }
    .dynamic-island { animation: dynamicDrop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
    
    @keyframes fragmentShatter {
      0% { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(1); }
      20% { opacity: 0.9; transform: translate(var(--tx-mid), var(--ty-mid)) rotate(var(--rot-mid)) scale(1.05); }
      100% { opacity: 0; transform: translate(var(--tx-end), var(--ty-end)) rotate(var(--rot-end)) scale(0.3); filter: blur(2px); }
    }

    .shatter-fragment {
      position: fixed;
      pointer-events: none;
      z-index: 9999;
      background-color: var(--fragment-bg);
      will-change: transform, opacity;
      border: 1px solid rgba(255, 255, 255, 0.4);
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .bar-is-shattering {
        opacity: 0 !important;
        pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);

  const pill = document.createElement("div");
  pill.id = "floatingPill";
  pill.className =
    "dynamic-island absolute top-[42px] left-1/2 z-30 bg-white/95 backdrop-blur-md border border-gray-200/60 shadow-md rounded-full px-2 py-1.5 flex items-center gap-1 transition-all duration-300 hover:shadow-lg";
  pill.innerHTML = `
    <button onclick="prevMonth(); event.stopPropagation();" class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition"><i class="fa-solid fa-chevron-left text-xs"></i></button>
    <div class="relative">
      <div class="px-3 text-sm font-black text-gray-800 hover:text-indigo-600 transition tracking-tight flex items-center gap-1.5 cursor-pointer" onclick="toggleMonthPicker()">
        <span id="floatingYearMonth">${currentYear}년 ${
    currentMonth + 1
  }월</span>
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
  tooltip.className =
    "glass-tooltip fixed pointer-events-none z-[120] opacity-0 bg-white/90 backdrop-blur-md border border-gray-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-xl p-3 transform -translate-x-1/2 -translate-y-[calc(100%+12px)] min-w-[180px] transition-opacity duration-150";
  document.body.appendChild(tooltip);

  document.addEventListener("mouseover", (e) => {
    if (
      e.target &&
      typeof e.target.className === "string" &&
      !e.target.className.includes("leave-bar")
    ) {
      hideProTooltip();
    }
  });
  document
    .getElementById("calendar")
    .addEventListener("scroll", hideProTooltip, { passive: true });
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
  if (
    box &&
    !box.classList.contains("pointer-events-none") &&
    !pill.contains(e.target)
  ) {
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
    btn.className = `w-full py-1.5 text-xs rounded-md font-bold snap-center transition ${
      active ? "bg-indigo-50 text-indigo-600" : "text-gray-500 hover:bg-gray-50"
    }`;
    btn.innerText = `${y}년`;
    btn.onclick = (e) => {
      e.stopPropagation();
      currentYear = y;
      document.getElementById(
        "floatingYearMonth"
      ).innerText = `${currentYear}년 ${currentMonth + 1}월`;
      renderMiniPickerLists();
      resetCalendarTo(currentYear, currentMonth);
    };
    yList.appendChild(btn);
    if (active) setTimeout(() => btn.scrollIntoView({ block: "center" }), 10);
  }
  for (let m = 0; m < 12; m++) {
    const btn = document.createElement("button");
    const active = m === currentMonth;
    btn.className = `w-full py-1.5 text-xs rounded-md font-bold snap-center transition ${
      active ? "bg-indigo-50 text-indigo-600" : "text-gray-500 hover:bg-gray-50"
    }`;
    btn.innerText = `${m + 1}월`;
    btn.onclick = (e) => {
      e.stopPropagation();
      toggleMonthPicker();
      currentMonth = m;
      document.getElementById(
        "floatingYearMonth"
      ).innerText = `${currentYear}년 ${currentMonth + 1}월`;
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
  document.getElementById("calendar").innerHTML = generateCellsHTML(
    renderStartDate,
    renderEndDate
  );
  renderEvents();
}

function generateCellsHTML(start, end) {
  let html = "";
  let iter = new Date(start);
  const todayStr = formatDate(
    new Date().getFullYear(),
    new Date().getMonth(),
    new Date().getDate()
  );
  while (iter <= end) {
    html += `<div class="week-row col-span-7 relative min-h-[120px] transition-all duration-300 border-b border-gray-100 flex w-full">`;
    let bgHtml = `<div class="absolute inset-0 grid grid-cols-7 w-full h-full">`;
    let daysInWeek = [];
    for (let i = 0; i < 7; i++) {
      const y = iter.getFullYear(),
        m = iter.getMonth(),
        d = iter.getDate();
      const fullDateStr = formatDate(y, m, d);
      daysInWeek.push(fullDateStr);
      const isToday = fullDateStr === todayStr;
      const isFirst = d === 1;
      const dateColor = isToday
        ? "bg-indigo-600 text-white px-2 py-0.5 rounded-full font-black inline-block"
        : i === 0
        ? "text-red-500 date-text"
        : i === 6
        ? "text-blue-500 date-text"
        : "text-gray-700 date-text";
      bgHtml += `<div class="day-cell border-r border-gray-100 flex flex-col p-1.5 relative transition-colors duration-300 hover:bg-indigo-50/30 cursor-pointer" data-date="${fullDateStr}"><div class="flex justify-between items-start z-0"><span class="holiday-name text-[10px] text-red-500 font-bold truncate max-w-[70%] drop-shadow-sm mt-0.5"></span><span class="text-xs font-bold transition-colors ${dateColor} ${
        isFirst && !isToday ? "text-indigo-600 text-sm" : ""
      }">${isFirst ? `${m + 1}월 ${d}일` : d}</span></div></div>`;
      iter.setDate(iter.getDate() + 1);
    }
    bgHtml += `</div>`;
    html +=
      bgHtml +
      `<div class="event-layer absolute top-8 left-0 right-0 bottom-1 pointer-events-none flex flex-col gap-[4px] z-10" data-week-start="${daysInWeek[0]}"></div></div>`;
  }
  return html;
}

function getDatesInRange(startStr, endStr) {
  const dates = [];
  let current = new Date(startStr.split("T")[0]);
  const end = new Date(endStr.split("T")[0]);
  while (current <= end) {
    dates.push(
      formatDate(current.getFullYear(), current.getMonth(), current.getDate())
    );
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
  container.addEventListener(
    "scroll",
    async () => {
      const rect = container.getBoundingClientRect();
      const el = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 3
      );
      const cell = el ? el.closest(".day-cell") : null;
      if (cell) {
        const [y, m] = cell.dataset.date.split("-");
        if (
          parseInt(y, 10) !== currentYear ||
          parseInt(m, 10) - 1 !== currentMonth
        ) {
          currentYear = parseInt(y, 10);
          currentMonth = parseInt(m, 10) - 1;
          updateVisualFocus(currentYear, currentMonth);
        }
      }
    },
    { passive: true }
  );
}

async function scrollToMonth(year, month, smooth = true) {
  const targetStr = formatDate(year, month, 1);
  let targetCell = document.querySelector(
    `.day-cell[data-date="${targetStr}"]`
  );

  if (!targetCell) {
    await resetCalendarTo(year, month);
    targetCell = document.querySelector(`.day-cell[data-date="${targetStr}"]`);
  }

  if (targetCell) {
    const calendar = document.getElementById("calendar");
    const targetRow = targetCell.closest(".week-row") || targetCell;
    calendar.scrollTo({
      top: Math.max(0, targetRow.offsetTop - 60),
      behavior: smooth ? "smooth" : "instant",
    });
    currentYear = year;
    currentMonth = month;
    updateVisualFocus(year, month);
  }
}

function renderEvents() {
  document
    .querySelectorAll(".event-layer")
    .forEach((el) => (el.innerHTML = ""));
  document
    .querySelectorAll(".holiday-name")
    .forEach((el) => (el.innerText = ""));

  const sortedLeaves = [...leavesCache].sort((a, b) => {
    if (a.isHoliday && !b.isHoliday) return -1;
    if (!a.isHoliday && b.isHoliday) return 1;
    const startA = new Date(a.startDate).getTime();
    const startB = new Date(b.startDate).getTime();
    if (startA !== startB) return startA - startB;
    return (
      new Date(b.endDate).getTime() -
      startA -
      (new Date(a.endDate).getTime() - startB)
    );
  });

  const levelMap = {};
  sortedLeaves.forEach((leave) => {
    if (leave.isHoliday) {
      const cell = document.querySelector(
        `.day-cell[data-date="${leave.startDate}"]`
      );
      if (cell) {
        const nameEl = cell.querySelector(".holiday-name");
        if (nameEl) nameEl.innerText = leave.title;
        cell.classList.add("bg-red-50/20");
      }
      return;
    }
    const datesStr = getDatesInRange(leave.startDate, leave.endDate);
    let targetLevel = 0,
      found = false;
    while (!found) {
      found = true;
      for (const dateStr of datesStr) {
        if (!levelMap[dateStr]) levelMap[dateStr] = [];
        if (levelMap[dateStr][targetLevel]) {
          found = false;
          break;
        }
      }
      if (!found) targetLevel++;
    }
    for (const dateStr of datesStr) levelMap[dateStr][targetLevel] = leave;
  });

  const weekRows = document.querySelectorAll(".week-row");
  weekRows.forEach((weekRow) => {
    const fgLayer = weekRow.querySelector(".event-layer");
    const days = Array.from(weekRow.querySelectorAll(".day-cell")).map(
      (cell) => cell.dataset.date
    );
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
      let currentLeave = null,
        startIndex = -1,
        span = 0;

      const drawBar = (leave, startIdx, sp) => {
        const bar = document.createElement("div");
        const isGlobalStart = leave.startDate.split("T")[0] === days[startIdx];
        const isGlobalEnd =
          leave.endDate.split("T")[0] === days[startIdx + sp - 1];
        bar.className = `absolute top-0 h-[22px] pointer-events-auto cursor-pointer transition-all duration-200 z-10 px-1.5 flex items-center text-[11px] font-bold text-white truncate shadow-sm leave-bar-${leave._id}`;
        bar.style.left = `calc(100% / 7 * ${startIdx})`;
        bar.style.width = `calc((100% / 7 * ${sp}) - 6px)`;
        bar.style.marginLeft = "3px";
        if (isGlobalStart && isGlobalEnd) bar.style.borderRadius = "4px";
        else if (isGlobalStart) bar.style.borderRadius = "4px 0 0 4px";
        else if (isGlobalEnd) bar.style.borderRadius = "0 4px 4px 0";

        const sText =
          {
            PENDING_REVIEW: "(검토대기)",
            PENDING_APPROVAL: "(승인대기)",
            REJECTED_REVIEW: "(검토거절)",
            REJECTED_APPROVAL: "(승인거절)",
            APPROVED: "",
            CANCEL_REQ_REVIEW: "(취소검토대기)",
            CANCEL_REQ_APPROVAL: "(취소승인대기)",
            CANCEL_APPROVED: "(취소승인됨 - 클릭하여 확인)",
          }[leave.status] || "";

        const displayName =
          currentCalendarMode === "team"
            ? `${leave.userId?.name || ""} ${sText}`
            : `[${leave.type || "휴가"}] ${leave.reason || ""} ${sText}`;
        bar.innerText = isGlobalStart || startIdx === 0 ? displayName : "";

        const fixedColor = getLeaveColor(leave.reason, leave.type);

        if (
          leave.status === "REJECTED_REVIEW" ||
          leave.status === "REJECTED_APPROVAL" ||
          leave.status === "CANCEL_APPROVED"
        ) {
          bar.style.backgroundColor = "rgba(156, 163, 175, 0.4)";
          bar.style.border = "1px dashed rgba(156, 163, 175, 0.8)";
          bar.style.color = "#4b5563"; // 灰色字體

          bar.onclick = (e) => {
            e.stopPropagation();
            hideProTooltip();

            createShatterAnimation(bar);

            setTimeout(async () => {
              try {
                await fetch(`/leaves/${leave._id}/confirm-reject`, {
                  method: "PUT",
                  headers: { Authorization: `Bearer ${currentToken}` },
                });
                await refreshCalendarData();
              } catch (err) {}
            }, 800);
          };
        } else if (leave.status.includes("CANCEL_REQ")) {
          bar.style.backgroundColor = "#f97316";
          bar.style.opacity = "0.8";
          bar.style.border = "1px dashed rgba(255, 255, 255, 0.9)";
        } else if (leave.status === "PENDING_REVIEW") {
          bar.style.backgroundColor = fixedColor;
          bar.style.opacity = "0.5";
          bar.style.border = "1px dashed rgba(255, 255, 255, 0.9)";
        } else if (leave.status === "PENDING_APPROVAL") {
          bar.style.backgroundColor = fixedColor;
          bar.style.opacity = "0.75";
          bar.style.border = "1px dashed rgba(255, 255, 255, 0.9)";
        } else {
          bar.style.backgroundColor = fixedColor;
          bar.style.opacity = "1";
          bar.style.border = "none";
        }

        if (
          !leave.status.includes("REJECTED") &&
          leave.status !== "CANCEL_APPROVED"
        ) {
          bar.addEventListener("mouseenter", (e) => {
            highlightLeave(leave._id);
            showProTooltip(
              e,
              `[${leave.type || "휴가"}] ${leave.userId?.name || ""} ${sText}`,
              `${leave.startDate.split("T")[0]} ~ ${
                leave.endDate.split("T")[0]
              }`,
              leave.reason || "사유 없음",
              bar.style.backgroundColor
            );
          });
          bar.addEventListener("mousemove", moveProTooltip);
          bar.addEventListener("mouseleave", () => {
            try {
              unhighlightLeave(leave._id);
            } catch (err) {}
            hideProTooltip();
          });
          bar.onclick = (e) => {
            e.stopPropagation();
            hideProTooltip();
            if (
              leave.status === "PENDING_REVIEW" ||
              leave.status === "PENDING_APPROVAL"
            ) {
              if (
                confirm(`일정을 취소/삭제하시겠습니까?\n사유: ${leave.reason}`)
              )
                cancelLeave(leave._id);
            } else if (leave.status === "APPROVED") {
              if (
                confirm(
                  `이미 승인된 휴가입니다. 취소 결재를 올리시겠습니까?\n사유: ${leave.reason}`
                )
              )
                cancelLeave(leave._id);
            } else if (leave.status.includes("CANCEL_REQ")) {
              alert("현재 취소 승인 대기 중입니다. (결재 진행 중)");
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
          if (currentLeave) {
            startIndex = i;
            span = 1;
          }
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
    if (e.button !== 0 || e.target.closest('[class*="leave-bar"]')) return;
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
      const d1 = new Date(dragStartStr),
        d2 = new Date(dragEndStr);
      const start = d1 < d2 ? d1 : d2,
        end = d1 < d2 ? d2 : d1;
      document.getElementById("reqStartDate").value = formatDate(
        start.getFullYear(),
        start.getMonth(),
        start.getDate()
      );
      document.getElementById("reqEndDate").value = formatDate(
        end.getFullYear(),
        end.getMonth(),
        end.getDate()
      );
      calculateReqDays();
      await openModal("requestModal");
    }
    clearSelectionVisuals();
  });
}

function updateSelectionVisuals() {
  clearSelectionVisuals();
  if (!dragStartStr || !dragEndStr) return;
  const d1 = new Date(dragStartStr),
    d2 = new Date(dragEndStr);
  const start = d1 < d2 ? d1 : d2,
    end = d1 < d2 ? d2 : d1;
  document.querySelectorAll(".day-cell").forEach((cell) => {
    const cellDate = new Date(cell.dataset.date);
    if (cellDate >= start && cellDate <= end)
      cell.classList.add(
        "bg-indigo-100/50",
        "shadow-[inset_0_0_0_2px_#818cf8]",
        "z-20"
      );
  });
}

function clearSelectionVisuals() {
  document.querySelectorAll(".day-cell").forEach((cell) => {
    cell.classList.remove(
      "bg-indigo-100/50",
      "shadow-[inset_0_0_0_2px_#818cf8]",
      "z-20"
    );
  });
}

async function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove("hidden");
  if (id === "requestModal") await loadMySlots();
}
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add("hidden");
}

// 🔥 修改 1：幹部登錄 (Grant) 拔除檔案上傳功能，改為傳送純 JSON
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
    alert("부여 검토가 등록되었습니다.");
    closeModal("grantModal");
    await loadMySlots(); 
  } catch (err) {
    alert("실패");
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
    listEl.innerHTML =
      '<div class="text-sm text-gray-400 text-center py-6">사용 가능한 휴가가 없습니다.</div>';
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
    const holidays = leavesCache
      .filter((l) => l.isHoliday)
      .map((l) => l.startDate.split("T")[0]);
    let iter = new Date(start);
    while (iter <= end) {
      const dStr = formatDate(
        iter.getFullYear(),
        iter.getMonth(),
        iter.getDate()
      );
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
    const isWeekendOnly =
      s.type === "외박" ||
      s.reason.includes("주말") ||
      s.reason.includes("정기외박");
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
      <div class="flex items-center justify-between p-3 rounded-xl border ${
        isUsed
          ? "border-indigo-400 bg-indigo-50/40"
          : "border-gray-200 bg-white"
      } shadow-sm transition-all mb-2">
        <div class="flex-1 min-w-0 pr-2">
          <p class="text-sm font-bold text-gray-800 truncate">[${typeTag}] ${
      s.reason
    }</p>
          <p class="text-[11px] text-gray-500 font-medium">잔여 ${
            s.remains
          }일</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button onclick="changeManualQty('${
            s._id
          }', -1)" class="w-6 h-6 border rounded border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold transition">-</button>
          <span class="w-5 text-center font-bold text-indigo-700">${qty}</span>
          <button onclick="changeManualQty('${
            s._id
          }', 1)" class="w-6 h-6 border rounded border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold transition">+</button>
        </div>
      </div>`;

    groupedSlots[typeTag].push(itemHtml);
  });

  let finalHtml = "";
  if (!hasVisibleSlots && startDate && endDate) {
    finalHtml =
      '<div class="text-sm text-red-500 text-center py-6 font-bold"><i class="fa-solid fa-triangle-exclamation mb-2 text-xl block"></i>선택하신 날짜(평일/주말)에 사용할 수 있는 휴가가 없습니다.</div>';
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
    diffDays =
      Math.ceil(
        (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
      ) + 1;

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
      if (calcBox)
        calcBox.className =
          "bg-red-50 border border-red-200 rounded-xl p-3.5 flex justify-between items-center transition-colors";
    } else {
      calcText.innerHTML = `<span class="text-indigo-600 font-bold text-sm">일치완료 (총 ${diffDays}일)</span>`;
      if (calcBox)
        calcBox.className =
          "bg-indigo-50 border border-indigo-200 rounded-xl p-3.5 flex justify-between items-center transition-colors";
    }
  }
}

function calculateReqDays() {
  currentUsedSlots = [];

  const startDate = document.getElementById("reqStartDate").value;
  const endDate = document.getElementById("reqEndDate").value;
  let diffDays = 0;
  if (startDate && endDate)
    diffDays =
      Math.ceil(
        (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
      ) + 1;

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
    calcBox.className =
      "bg-red-50 border border-red-200 rounded-xl p-3.5 flex justify-between items-center transition-colors";
  }
}

// 🔥 修改 2：勇士申請 (Request) 升級為 FormData 多檔案上傳模式
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

  // 使用 FormData 來處理檔案上傳
  const formData = new FormData();
  formData.append("startDate", startDate);
  formData.append("endDate", endDate);
  formData.append("destination", destination);
  formData.append("emergencyContact", contact);
  formData.append("reason", reason);
  formData.append("usedSlots", JSON.stringify(currentUsedSlots)); // 陣列轉字串

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
      headers: { Authorization: "Bearer " + currentToken }, // FormData 不需要 Content-Type
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

async function fetchLeavesFromDB() {
  const endpoint =
    currentCalendarMode === "personal" ? "/leaves/my" : "/leaves/all";
  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${currentToken}` },
  });
  dbLeavesCache = (await res.json()).leaves || [];
}

async function fetchGoogleHolidays(start, end) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        KOREA_HOLIDAY_CALENDAR_ID
      )}/events?key=${GOOGLE_API_KEY}&timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`
    );
    return ((await res.json()).items || []).map((ev) => ({
      _id: "hol-" + ev.id,
      type: "holiday",
      title: ev.summary,
      startDate: ev.start.date,
      endDate: ev.start.date,
      isHoliday: true,
      userId: { name: "공휴일" },
    }));
  } catch {
    return [];
  }
}

function prevMonth() {
  currentMonth--;
  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  }
  scrollToMonth(currentYear, currentMonth, true);
}
function nextMonth() {
  currentMonth++;
  if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }
  scrollToMonth(currentYear, currentMonth, true);
}
function goToCurrentMonth() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
  scrollToMonth(currentYear, currentMonth, true);
}

async function cancelLeave(id) {
  try {
    const res = await fetch(`/leaves/${id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + currentToken },
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      await refreshCalendarData();
    } else {
      alert(data.error || "오류가 발생했습니다.");
    }
  } catch (err) {
    console.error(err);
  }
}

function formatDate(y, m, d) {
  const date = new Date(y, m, d, 12, 0, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function getLeaveColor(reason, type) {
  const palette = {
    연가: "#3b82f6",
    포상: "#1d4ed8",
    위로: "#0ea5e9",
    보상: "#0284c7",
    기타: "#64748b",
    정기외박: "#8b5cf6",
    특별외박: "#6d28d9",
    외박: "#7c3aed",
    평일정기외출: "#10b981",
    주말정기외출: "#059669",
    평일특별외출: "#14b8a6",
    주말특별외출: "#0f766e",
    외출: "#10b981",
  };

  if (reason) {
    for (const key in palette) {
      if (reason.includes(key)) return palette[key];
    }
  }

  if (type) {
    if (type.includes("외박")) return palette["외박"];
    if (type.includes("외출")) return palette["외출"];
  }

  return palette["연가"];
}

function highlightLeave(id) {
  document.querySelectorAll(`.leave-bar-${id}`).forEach((el) => {
    el.style.filter = "brightness(1.15)";
    el.style.zIndex = "50";
  });
}

function unhighlightLeave(id) {
  document.querySelectorAll(`.leave-bar-${id}`).forEach((el) => {
    el.style.filter = "none";
    el.style.zIndex = "10";
  });
}

function logout() {
  localStorage.removeItem("token");
  window.location.href = "/login.html";
}

function createShatterAnimation(barEl) {
  const rect = barEl.getBoundingClientRect();
  const fragmentCount = 30;
  const shardsContainer = [];

  barEl.classList.add("bar-is-shattering");

  for (let i = 0; i < fragmentCount; i++) {
    const shard = document.createElement("div");
    shard.className = "shatter-fragment";

    const sW = 6 + Math.random() * 20;
    const sH = 6 + Math.random() * 20;
    shard.style.width = `${sW}px`;
    shard.style.height = `${sH}px`;

    shard.style.setProperty("--fragment-bg", "#6b7280");

    const points = [
      `${Math.random() * 10}% ${Math.random() * 10}%`,
      `${90 + Math.random() * 10}% ${Math.random() * 10}%`,
      `${90 + Math.random() * 10}% ${90 + Math.random() * 10}%`,
      `${Math.random() * 10}% ${90 + Math.random() * 10}%`,
    ];
    shard.style.clipPath = `polygon(${points.join(",")})`;

    shard.style.left = `${rect.left + Math.random() * (rect.width - sW)}px`;
    shard.style.top = `${rect.top + Math.random() * (rect.height - sH)}px`;

    const direction = Math.random() < 0.5 ? -1 : 1;

    const txMid = ((Math.random() * rect.width) / 4) * direction;
    const tyMid = -(10 + Math.random() * 15);
    const rotMid = direction * (30 + Math.random() * 60);

    const txEnd = Math.random() * rect.width * direction * 1.2;
    const tyEnd = 50 + Math.random() * 80;
    const rotEnd = direction * (180 + Math.random() * 360);

    shard.style.setProperty("--tx-mid", `${txMid}px`);
    shard.style.setProperty("--ty-mid", `${tyMid}px`);
    shard.style.setProperty("--rot-mid", `${rotMid}deg`);
    shard.style.setProperty("--tx-end", `${txEnd}px`);
    shard.style.setProperty("--ty-end", `${tyEnd}px`);
    shard.style.setProperty("--rot-end", `${rotEnd}deg`);

    const duration = 0.7 + Math.random() * 0.4;
    const delay = Math.random() * 0.05;
    shard.style.animation = `fragmentShatter ${duration}s cubic-bezier(0.25, 1, 0.5, 1) ${delay}s forwards`;

    document.body.appendChild(shard);
    shardsContainer.push(shard);
  }

  setTimeout(() => {
    shardsContainer.forEach((s) => s.remove());
  }, 1500);
}