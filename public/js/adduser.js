// 🔹 SPA 안전 전역 변수
window.allActiveUsers = window.allActiveUsers || [];

// 🚀 [SPA 핵심] 페이지가 전환될 때마다 실행될 초기화 함수
window.fetchUsers = async function() {
  const token = localStorage.getItem("token");
  if (!token) {
    alert("로그인이 필요합니다.");
    window.location.href = "login.html";
    return;
  }

  // 🔥 검색창 이벤트 리스너 다시 달아주기 (DOM이 새로 그려졌기 때문)
  const searchInput = document.getElementById("searchUser");
  if (searchInput) {
    // 이벤트 리스너 중복 바인딩 방지를 위해 Node 복제 후 교체
    const newSearchInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newSearchInput, searchInput);
    
    newSearchInput.addEventListener("input", (e) => {
      const keyword = e.target.value.toLowerCase();
      const filtered = window.allActiveUsers.filter(
        (u) =>
          (u.name && u.name.toLowerCase().includes(keyword)) ||
          (u.serviceNumber && u.serviceNumber.includes(keyword))
      );
      renderUsers(filtered);
    });
  }

  await window.loadPendingUsers();
  await window.loadUsers();
};

// 🔹 기존 새로고침(F5) 대응 및 SPA 호출 대비
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", window.fetchUsers);
}

// 🔹 1. 승인 대기 인원 불러오기
window.loadPendingUsers = async function() {
  const token = localStorage.getItem("token");
  try {
    const res = await fetch("/pending-users", {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await res.json();
    renderPending(data.users || []);
  } catch (err) {
    console.error("대기 인원 로딩 오류:", err);
  }
};

// 🔹 2. 승인 대기 인원 화면 출력
function renderPending(users) {
  const section = document.getElementById("pendingSection");
  const list = document.getElementById("pendingList");
  const count = document.getElementById("pendingCount");

  if (count) count.innerText = users.length;

  if (users.length === 0) {
    if (section) section.classList.add("hidden");
    return;
  } else {
    if (section) section.classList.remove("hidden");
  }

  if (!list) return;
  list.innerHTML = "";

  users.forEach((user) => {
    list.innerHTML += `
      <div class="flex items-center justify-between w-full bg-white px-5 py-4 rounded-xl border border-yellow-200 shadow-sm mb-2 hover:shadow-md transition">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-full bg-yellow-50 border border-yellow-100 flex items-center justify-center text-yellow-600">
            <i class="fa-solid fa-user-clock"></i>
          </div>
          <div>
            <p class="font-bold text-gray-800">${
              user.name
            } <span class="text-xs text-gray-500 font-normal">(${
      user.rank || "계급없음"
    })</span></p>
            <p class="text-xs text-gray-500 font-mono mt-0.5">군번: ${
              user.serviceNumber
            }</p>
          </div>
        </div>
        <div class="flex gap-2">
          <button onclick="window.approveUser('${
            user._id
          }')" class="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700 transition shadow-sm">승인</button>
          <button onclick="window.rejectUser('${
            user._id
          }')" class="px-3 py-1.5 bg-red-100 text-red-600 text-xs font-bold rounded hover:bg-red-200 transition">거절</button>
        </div>
      </div>
    `;
  });
}

// 🔹 3. 승인/거절 처리
window.approveUser = async function(userId) {
  const token = localStorage.getItem("token");
  if (!confirm("해당 인원의 가입을 승인하시겠습니까?")) return;
  try {
    const res = await fetch(`/approve-user/${userId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    window.loadPendingUsers();
    window.loadUsers();
  } catch (err) {
    alert("서버 오류가 발생했습니다.");
  }
};

window.rejectUser = async function(userId) {
  const token = localStorage.getItem("token");
  if (!confirm("해당 인원의 가입을 거절하시겠습니까?")) return;
  try {
    const res = await fetch(`/reject-user/${userId}`, {
      method: "DELETE", 
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    window.loadPendingUsers();
  } catch (err) {
    alert("서버 오류가 발생했습니다.");
  }
};

// 🔹 4. 기존 부대원 불러오기
window.loadUsers = async function() {
  const token = localStorage.getItem("token");
  try {
    const res = await fetch("/users/org-members", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (data.success) {
      window.allActiveUsers = data.members || [];
      const countEl = document.getElementById("activeCount");
      if (countEl) countEl.innerText = window.allActiveUsers.length;
      renderUsers(window.allActiveUsers);
    } else {
      const oldRes = await fetch("/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const oldData = await oldRes.json();
      window.allActiveUsers = (oldData.users || []).filter(
        (u) => u.status === "approved"
      );
      renderUsers(window.allActiveUsers);
    }
  } catch (err) {
    console.error("부대원 로딩 오류:", err);
  }
};

// 🔹 6. 부대원 출력
function renderUsers(users) {
  const list = document.getElementById("userList");
  if (!list) return;
  list.innerHTML = "";

  if (users.length === 0) {
    list.innerHTML = `
      <div class='w-full text-center py-8 bg-gray-50 border border-dashed border-gray-200 rounded-xl text-gray-400 font-medium'>
        검색 결과 또는 소속된 부대원이 없습니다.
      </div>`;
    return;
  }

  users.forEach((user) => {
    let roleHtml = "";
    // 🔥 確保自己不能降級自己 (這裡假設 superadmin 不能被降級)
    const canDelete = user.role !== "superadmin";

    if (!canDelete) {
      const roleText = "최고 관리자 (管理者)";
      const bgClass = "bg-purple-50 text-purple-700 border-purple-200";
      roleHtml = `<span class="px-3 py-1.5 ${bgClass} border rounded-lg font-bold text-xs shadow-sm inline-block min-w-[100px] text-center">${roleText}</span>`;
    } else {
      roleHtml = `
        <select onchange="window.changeUserRole('${
          user._id
        }', this.value)" class="text-xs font-bold text-gray-700 border border-gray-300 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-sm hover:bg-gray-50 transition-colors">
          <option value="soldier" ${
            user.role === "soldier" ? "selected" : ""
          }>용사 (勇士)</option>
          <option value="officer" ${
            (user.role === "officer" || user.role === "reviewer" || user.role === "approver") ? "selected" : ""
          }>간부 (幹部)</option>
        </select>`;
    }

    const deleteBtn = canDelete
      ? `<button onclick="window.dischargeUser('${user._id}', '${user.name}')" class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors border border-transparent hover:border-red-200" title="전역/삭제">
          <i class="fa-solid fa-trash-can"></i>
        </button>`
      : `<div class="w-8 h-8"></div>`;

    const displayRank = user.currentRank || user.rank || "계급없음";

    const hrBtn = user.role === "soldier" && user.enlistmentDate
        ? `<button onclick='window.openHrModal(${JSON.stringify(user).replace(
            /'/g,
            "&#39;"
          )})' class="ml-2 px-3 py-1.5 bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 text-xs font-bold rounded-lg shadow-sm transition flex items-center gap-1.5" title="인사 관리">
           <i class="fa-solid fa-clipboard-user"></i>
         </button>`
        : ``;

    list.innerHTML += `
      <div class="flex items-center justify-between w-full bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm hover:border-indigo-300 transition-colors mb-2">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-gray-200 to-gray-300 flex items-center justify-center text-gray-600 font-black shadow-inner">
            ${user.name ? user.name.charAt(0) : "U"}
          </div>
          <div>
            <p class="font-bold text-gray-800 flex items-center">${
              user.name
            } <span class="text-xs text-gray-500 font-normal ml-1">(${displayRank})</span></p>
            <p class="text-xs text-gray-500 font-mono mt-0.5">군번: ${
              user.serviceNumber
            }</p>
          </div>
        </div>
        
        <div class="flex items-center gap-2 sm:gap-3">
          ${roleHtml}
          ${hrBtn}
          ${deleteBtn}
        </div>
      </div>
    `;
  });
}

// 🔹 7. 삭제(전역) 처리
window.dischargeUser = async function(userId, userName) {
  const token = localStorage.getItem("token");
  if (!confirm(`정말로 ${userName} 인원을 삭제(전역) 처리하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  try {
    const res = await fetch(`/members/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    window.loadUsers();
  } catch (err) {
    alert("서버 오류가 발생했습니다.");
  }
};

// 🔹 8. 권한 변경 처리
window.changeUserRole = async function(userId, newRole) {
  const token = localStorage.getItem("token");
  let newRank = newRole === "officer" ? "간부" : "용사";
  try {
    const res = await fetch(`/members/${userId}/role`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ role: newRole, rank: newRank }),
    });
    const data = await res.json();

    if (data.error) {
      alert(data.error);
      window.loadUsers();
    } else {
      const toast = document.createElement("div");
      toast.className =
        "fixed bottom-10 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-6 py-3 rounded-full shadow-2xl font-bold text-sm z-[100] transition-opacity duration-300";
      toast.innerText = "권한이 성공적으로 변경되었습니다.";
      document.body.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
      }, 2000);
      window.loadUsers();
    }
  } catch (err) {
    alert("서버 오류가 발생했습니다.");
    window.loadUsers();
  }
};

// 🚀 ==========================================
// 🔥 HR 인사 관리 모달 로직 (완벽 수정본)
// ==============================================

function formatDate(dateString) {
  if (!dateString) return "-";
  const d = new Date(dateString);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

window.openHrModal = function(user) {
  document.getElementById("currentHrUserId").value = user._id;
  
  const nameEl = document.getElementById("hrName");
  if (nameEl) nameEl.innerText = `${user.name} 용사`;
  
  const rankEl = document.getElementById("hrRankBadge");
  if (rankEl) rankEl.innerText = user.currentRank || "이병";
  
  const numEl = document.getElementById("hrServiceNum");
  if (numEl) numEl.innerText = user.serviceNumber;

  // 🔥 방어 코드: 화면에 없으면 값을 넣지 않음 (여기서 에러가 나면 창이 안 켜짐)
  const enlistEl = document.getElementById("hrEnlistDate");
  if (enlistEl) enlistEl.innerText = formatDate(user.enlistmentDate);
  
  const dischargeEl = document.getElementById("hrDischargeDate");
  if (dischargeEl) dischargeEl.innerText = formatDate(user.dischargeDate);

  window.renderHrTimeline(user);
  
  const modal = document.getElementById("hrModal");
  if (modal) modal.classList.remove("hidden");
};

window.renderHrTimeline = function(user) {
  const container = document.getElementById("hrTimelineContainer");
  if (!container) return;
  const today = new Date();

  const milestones = [
    {
      rank: "병장", date: user.promoToByungjang, canAdjust: true, icon: "fa-star",
      bgActive: "bg-purple-500", textActive: "text-purple-700", borderActive: "border-purple-200", 
      shadowActive: "shadow-purple-500/30", badgeBg: "bg-purple-50", badgeText: "text-purple-600", 
      badgeBorder: "border-purple-100", barGradient: "from-purple-400 to-purple-300", ringClass: "ring-purple-50"
    },
    {
      rank: "상병", date: user.promoToSangbyung, canAdjust: true, icon: "fa-angles-up",
      bgActive: "bg-indigo-500", textActive: "text-indigo-700", borderActive: "border-indigo-200", 
      shadowActive: "shadow-indigo-500/30", badgeBg: "bg-indigo-50", badgeText: "text-indigo-600", 
      badgeBorder: "border-indigo-100", barGradient: "from-indigo-400 to-indigo-300", ringClass: "ring-indigo-50"
    },
    {
      rank: "일병", date: user.promoToIlbyung, canAdjust: false, icon: "fa-angles-up",
      bgActive: "bg-blue-500", textActive: "text-blue-700", borderActive: "border-blue-200", 
      shadowActive: "shadow-blue-500/30", badgeBg: "bg-blue-50", badgeText: "text-blue-600", 
      badgeBorder: "border-blue-100", barGradient: "from-blue-400 to-blue-300", ringClass: "ring-blue-50"
    },
    {
      rank: "이병 (입대)", date: user.enlistmentDate, canAdjust: false, icon: "fa-person-military-pointing",
      bgActive: "bg-slate-500", textActive: "text-slate-700", borderActive: "border-slate-200", 
      shadowActive: "shadow-slate-500/30", badgeBg: "bg-slate-50", badgeText: "text-slate-600", 
      badgeBorder: "border-slate-100", barGradient: "from-slate-400 to-slate-300", ringClass: "ring-slate-50"
    },
  ];

  let html = `<div class="relative pl-1 py-2">`;
  html += `<div class="absolute left-[1.6rem] top-8 bottom-8 w-1 bg-gray-100 rounded-full z-0"></div>`;

  milestones.forEach((m) => {
    if (!m.date) return;
    const targetDate = new Date(m.date);
    const isPassed = today >= targetDate;

    const nodeClass = isPassed 
        ? `${m.bgActive} text-white shadow-md ${m.shadowActive} ring-4 ${m.ringClass}` 
        : `bg-white text-gray-300 border-2 border-dashed border-gray-300 ring-4 ring-white`;
    
    const cardBorder = isPassed ? `${m.borderActive} bg-white` : `border-gray-100 bg-gray-50/50 opacity-80`;
    const textClass = isPassed ? m.textActive : `text-gray-400`;

    let actionButtons = "";
    // 🔥 修改點：只有「尚未晉升」且「設定為可調整」的階級才顯示按鈕
    if (m.canAdjust && !isPassed) {
      actionButtons = `
        <div class="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100/80">
            <button onclick="window.adjustPromotion('${user._id}', '${m.rank}', -1)" class="flex-1 py-1.5 bg-white border border-gray-200 rounded-md text-[11px] font-bold text-gray-600 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 transition shadow-sm">
              <i class="fa-solid fa-arrow-left text-[10px] mr-1 text-indigo-400"></i> 조기진급
            </button>
            <button onclick="window.adjustPromotion('${user._id}', '${m.rank}', 1)" class="flex-1 py-1.5 bg-white border border-gray-200 rounded-md text-[11px] font-bold text-gray-600 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 transition shadow-sm">
              진급누락 <i class="fa-solid fa-arrow-right text-[10px] ml-1 text-rose-400"></i>
            </button>
        </div>
      `;
    }

    html += `
        <div class="relative flex items-start gap-4 mb-6 z-10 group">
            <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 z-10 transition-all duration-300 group-hover:scale-110 mt-1 ${nodeClass}">
                <i class="fa-solid ${m.icon} text-sm"></i>
            </div>
            <div class="flex-1 rounded-2xl p-4 border ${cardBorder} shadow-sm transition-all duration-300 group-hover:shadow-md relative overflow-hidden">
                ${isPassed ? `<div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${m.barGradient}"></div>` : ''}
                <div class="flex justify-between items-start">
                    <div>
                        <p class="text-sm font-black ${textClass} mb-1 tracking-tight">${m.rank} ${m.rank.includes("입대") ? "" : "진급"}</p>
                        <p class="font-mono text-sm font-bold ${isPassed ? 'text-gray-800' : 'text-gray-400'}">${formatDate(m.date)}</p>
                    </div>
                    ${
                      isPassed
                        ? `<span class="text-[10px] ${m.badgeBg} ${m.badgeText} px-2 py-1 rounded-md font-black shadow-sm border ${m.badgeBorder} flex items-center"><i class="fa-solid fa-check mr-1 opacity-70"></i> 달성</span>`
                        : `<span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded-md font-bold border border-gray-200 flex items-center"><i class="fa-solid fa-lock mr-1 opacity-50"></i> 예정</span>`
                    }
                </div>
                ${actionButtons}
            </div>
        </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
};

window.adjustPromotion = async function(userId, targetRank, months) {
  const token = localStorage.getItem("token");
  const actionName = months < 0 ? "조기진급(1개월 앞당김)" : "진급누락(1개월 미룸)";
  if (!confirm(`${targetRank} 진급일을 ${actionName} 처리하시겠습니까?`)) return;

  try {
    const res = await fetch(`/users/${userId}/promotion-adjust`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetRank, monthsToAdjust: months }),
    });
    const data = await res.json();

    if (data.success) {
      alert(data.message);
      await window.loadUsers();
      const updatedUser = window.allActiveUsers.find((u) => u._id === userId);
      if (updatedUser) {
        document.getElementById("hrRankBadge").innerText = updatedUser.currentRank;
        window.renderHrTimeline(updatedUser);
      }
    } else {
      alert(data.error);
    }
  } catch (e) {
    alert("서버 통신 오류");
  }
};