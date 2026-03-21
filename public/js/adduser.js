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

  await loadPendingUsers();
  await loadUsers();
};

// 🔹 기존 새로고침(F5) 대응 및 SPA 호출 대비
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", window.fetchUsers);
} else {
  // 이미 로드된 상태라면 즉시 실행하지 않고, 
  // SPA 엔진(adduser.ejs 하단의 setTimeout)이 호출할 때까지 기다립니다.
  // 이렇게 해야 DOM이 완전히 준비된 상태에서만 데이터를 그림.
}

// 🔹 1. 승인 대기 인원 불러오기
async function loadPendingUsers() {
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
}

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
          <button onclick="approveUser('${
            user._id
          }')" class="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700 transition shadow-sm">승인</button>
          <button onclick="rejectUser('${
            user._id
          }')" class="px-3 py-1.5 bg-red-100 text-red-600 text-xs font-bold rounded hover:bg-red-200 transition">거절</button>
        </div>
      </div>
    `;
  });
}

// 🔹 3. 승인/거절 처리
async function approveUser(userId) {
  const token = localStorage.getItem("token");
  if (!confirm("해당 인원의 가입을 승인하시겠습니까?")) return;
  try {
    const res = await fetch(`/approve-user/${userId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    loadPendingUsers();
    loadUsers();
  } catch (err) {
    alert("서버 오류가 발생했습니다.");
  }
}

// 중복된 rejectUser를 병합하여 올바른 HTTP Method(DELETE)로 수정
async function rejectUser(userId) {
  const token = localStorage.getItem("token");
  if (!confirm("해당 인원의 가입을 거절하시겠습니까?")) return;
  try {
    const res = await fetch(`/reject-user/${userId}`, {
      method: "DELETE", 
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    loadPendingUsers();
  } catch (err) {
    alert("서버 오류가 발생했습니다.");
  }
}

// 🔹 4. 기존 부대원 불러오기
async function loadUsers() {
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
}

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
    const canDelete = user.role !== "reviewer" && user.role !== "approver";

    if (!canDelete) {
      const roleText = user.role === "reviewer" ? "검토자 (檢討者)" : "승인자 (批准者)";
      const bgClass = user.role === "reviewer" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-emerald-50 text-emerald-700 border-emerald-200";
      roleHtml = `<span class="px-3 py-1.5 ${bgClass} border rounded-lg font-bold text-xs shadow-sm inline-block min-w-[100px] text-center">${roleText}</span>`;
    } else {
      roleHtml = `
        <select onchange="changeUserRole('${
          user._id
        }', this.value)" class="text-xs font-bold text-gray-700 border border-gray-300 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-sm hover:bg-gray-50 transition-colors">
          <option value="soldier" ${
            user.role === "soldier" ? "selected" : ""
          }>용사 (勇士)</option>
          <option value="officer" ${
            user.role === "officer" ? "selected" : ""
          }>간부 (幹部)</option>
        </select>`;
    }

    const deleteBtn = canDelete
      ? `<button onclick="dischargeUser('${user._id}', '${user.name}')" class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors border border-transparent hover:border-red-200" title="전역/삭제">
          <i class="fa-solid fa-trash-can"></i>
        </button>`
      : `<div class="w-8 h-8"></div>`;

    const displayRank = user.currentRank || user.rank || "계급없음";

    const hrBtn = user.role === "soldier" && user.enlistmentDate
        ? `<button onclick='openHrModal(${JSON.stringify(user).replace(
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
async function dischargeUser(userId, userName) {
  const token = localStorage.getItem("token");
  if (!confirm(`정말로 ${userName} 인원을 삭제(전역) 처리하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  try {
    const res = await fetch(`/members/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    loadUsers();
  } catch (err) {
    alert("서버 오류가 발생했습니다.");
  }
}

// 🔹 8. 권한 변경 처리
async function changeUserRole(userId, newRole) {
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
      loadUsers();
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
      loadUsers();
    }
  } catch (err) {
    alert("서버 오류가 발생했습니다.");
    loadUsers();
  }
}

// 🔹 9. 새 부대원 수동 추가 (🔥 누락되었던 기능 복원)
async function addUser() {
  const token = localStorage.getItem("token");
  const name = document.getElementById("newUserName").value;
  const serviceNumber = document.getElementById("newUserServiceNumber").value;
  const email = document.getElementById("newUserGmail").value;

  if (!name || !serviceNumber || !email) {
    alert("모든 정보를 입력해주세요.");
    return;
  }

  try {
    const res = await fetch("/api/members", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, serviceNumber, email, role: "soldier" }),
    });
    const result = await res.json();
    if (result.success) {
      alert("부대원이 성공적으로 추가되었습니다.");
      document.getElementById("newUserName").value = "";
      document.getElementById("newUserServiceNumber").value = "";
      document.getElementById("newUserGmail").value = "";
      if (typeof closeModal === "function") closeModal("userModal");
      loadUsers();
    } else {
      alert(result.error || "추가에 실패했습니다.");
    }
  } catch (err) {
    alert("서버 통신 오류가 발생했습니다.");
  }
}

// 🚀 ==========================================
// 🔥 HR 인사 관리 모달 로직
// ==============================================

function formatDate(dateString) {
  if (!dateString) return "-";
  const d = new Date(dateString);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function openHrModal(user) {
  document.getElementById("currentHrUserId").value = user._id;
  document.getElementById("hrName").innerText = `${user.name} 용사`;
  document.getElementById("hrRankBadge").innerText = user.currentRank || "이병";
  document.getElementById("hrServiceNum").innerText = user.serviceNumber;
  document.getElementById("hrEnlistDate").innerText = formatDate(user.enlistmentDate);
  document.getElementById("hrDischargeDate").innerText = formatDate(user.dischargeDate);

  renderHrTimeline(user);
  document.getElementById("hrModal").classList.remove("hidden");
}

function renderHrTimeline(user) {
  const container = document.getElementById("hrTimelineContainer");
  const today = new Date();

  const milestones = [
    { rank: "일병", date: user.promoToIlbyung, icon: "fa-angles-up", color: "blue", canAdjust: false },
    { rank: "상병", date: user.promoToSangbyung, icon: "fa-angles-up", color: "indigo", canAdjust: true },
    { rank: "병장", date: user.promoToByungjang, icon: "fa-star", color: "purple", canAdjust: true },
  ];

  let html = "";

  milestones.forEach((m) => {
    if (!m.date) return;
    const targetDate = new Date(m.date);
    const isPassed = today >= targetDate;

    const bgClass = isPassed ? `bg-${m.color}-500` : `bg-gray-200`;
    const textClass = isPassed ? `text-${m.color}-600` : `text-gray-400`;
    const borderClass = isPassed ? `border-${m.color}-200` : `border-gray-200`;

    let actionButtons = "";
    if (m.canAdjust) {
      actionButtons = `
        <div class="flex items-center gap-1 mt-2">
            <button onclick="adjustPromotion('${user._id}', '${m.rank}', -1)" class="px-2 py-1 bg-white border border-gray-200 rounded text-[10px] font-bold text-gray-600 hover:text-indigo-600 hover:border-indigo-200 transition shadow-sm" title="진급일을 1개월 앞당깁니다.">[-] 조기진급</button>
            <button onclick="adjustPromotion('${user._id}', '${m.rank}', 1)" class="px-2 py-1 bg-white border border-gray-200 rounded text-[10px] font-bold text-gray-600 hover:text-red-600 hover:border-red-200 transition shadow-sm" title="진급일을 1개월 미룹니다.">[+] 진급누락</button>
        </div>
      `;
    }

    html += `
        <div class="relative flex items-start gap-4 z-10">
            <div class="w-8 h-8 rounded-full ${bgClass} text-white flex items-center justify-center shadow-sm ring-4 ring-white z-10 mt-1 transition-colors duration-500">
                <i class="fa-solid ${m.icon} text-xs"></i>
            </div>
            <div class="flex-1 bg-white rounded-xl p-3 border ${borderClass} shadow-sm transition-colors duration-500">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="text-sm font-black ${textClass} mb-0.5">${m.rank} 진급</p>
                        <p class="font-mono text-sm font-bold text-gray-800">${formatDate(m.date)}</p>
                    </div>
                    ${
                      isPassed
                        ? '<span class="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold">완료됨</span>'
                        : '<span class="text-[10px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded font-bold">예정</span>'
                    }
                </div>
                ${actionButtons}
            </div>
        </div>
    `;
  });

  container.innerHTML = html;
}

async function adjustPromotion(userId, targetRank, months) {
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
      await loadUsers();
      const updatedUser = window.allActiveUsers.find((u) => u._id === userId);
      if (updatedUser) {
        document.getElementById("hrRankBadge").innerText = updatedUser.currentRank;
        renderHrTimeline(updatedUser);
      }
    } else {
      alert(data.error);
    }
  } catch (e) {
    alert("서버 통신 오류");
  }
}