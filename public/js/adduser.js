const token = localStorage.getItem("token");
let allActiveUsers = [];

// 🔹 0. 페이지 로드 시 토큰 확인 및 초기화
document.addEventListener("DOMContentLoaded", () => {
  if (!token) {
    alert("로그인이 필요합니다.");
    window.location.href = "login.html";
    return;
  }
  loadPendingUsers();
  loadUsers();
});

// 🔹 1. 승인 대기 인원 불러오기
async function loadPendingUsers() {
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
  if (!confirm("해당 인원의 가입을 승인하시겠습니까?")) return;
  try {
    const res = await fetch(`/approve-user/${userId}`, {
      method: "POST",
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

async function rejectUser(userId) {
  if (!confirm("해당 인원의 가입을 거절하시겠습니까?")) return;
  try {
    const res = await fetch(`/reject-user/${userId}`, {
      method: "POST",
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
  try {
    const res = await fetch("/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    allActiveUsers = (data.users || []).filter((u) => u.status === "approved");
    const countEl = document.getElementById("activeCount");
    if (countEl) countEl.innerText = allActiveUsers.length;

    renderUsers(allActiveUsers);
  } catch (err) {
    console.error("부대원 로딩 오류:", err);
  }
}

// 🔹 5. 검색 기능
const searchInput = document.getElementById("searchUser");
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    const keyword = e.target.value.toLowerCase();
    const filtered = allActiveUsers.filter(
      (u) =>
        (u.name && u.name.toLowerCase().includes(keyword)) ||
        (u.serviceNumber && u.serviceNumber.includes(keyword))
    );
    renderUsers(filtered);
  });
}

// 🔹 6. 부대원 출력 (🔥 검토자/승인자 고정 및 삭제 방어 로직 완벽 적용)
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

    // 검토자와 승인자는 삭제 불가능하게 설정
    const canDelete = user.role !== "reviewer" && user.role !== "approver";

    // 권한 표시/변경 셀렉트 박스 로직
    if (!canDelete) {
      // 검토자, 승인자는 변경 불가 (텍스트 배지로 고정)
      const roleText =
        user.role === "reviewer" ? "검토자 (檢討者)" : "승인자 (批准者)";
      const bgClass =
        user.role === "reviewer"
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : "bg-emerald-50 text-emerald-700 border-emerald-200";

      roleHtml = `<span class="px-3 py-1.5 ${bgClass} border rounded-lg font-bold text-xs shadow-sm inline-block min-w-[100px] text-center">${roleText}</span>`;
    } else {
      // 용사, 간부는 변경 가능 (Select Box 표시)
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

    // 삭제 버튼 로직
    const deleteBtn = canDelete
      ? `<button onclick="dischargeUser('${user._id}', '${user.name}')" class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors border border-transparent hover:border-red-200" title="전역/삭제">
          <i class="fa-solid fa-trash-can"></i>
        </button>`
      : `<div class="w-8 h-8"></div>`;

    list.innerHTML += `
      <div class="flex items-center justify-between w-full bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm hover:border-indigo-300 transition-colors mb-2">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-gray-200 to-gray-300 flex items-center justify-center text-gray-600 font-black shadow-inner">
            ${user.name ? user.name.charAt(0) : "U"}
          </div>
          <div>
            <p class="font-bold text-gray-800 flex items-center">${
              user.name
            } <span class="text-xs text-gray-500 font-normal ml-1">(${
      user.rank || "계급없음"
    })</span></p>
            <p class="text-xs text-gray-500 font-mono mt-0.5">군번: ${
              user.serviceNumber
            }</p>
          </div>
        </div>
        
        <div class="flex items-center gap-2 sm:gap-3">
          ${roleHtml}
          ${deleteBtn}
        </div>
      </div>
    `;
  });
}

// 🔹 7. 삭제(전역) 처리
async function dischargeUser(userId, userName) {
  if (
    !confirm(
      `정말로 ${userName} 인원을 삭제(전역) 처리하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`
    )
  )
    return;

  try {
    const res = await fetch(`/members/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json();
    if (data.error) {
      alert(data.error);
      return;
    }
    loadUsers();
  } catch (err) {
    alert("서버 오류가 발생했습니다.");
  }
}

// 🔹 8. 권한 변경 처리 (용사 <-> 간부)
async function changeUserRole(userId, newRole) {
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
      loadUsers(); // 실패 시 원래대로 되돌리기 위해 다시 렌더링
    } else {
      // 성공 시 가벼운 Toast 알림 (UX 개선)
      const toast = document.createElement("div");
      toast.className =
        "fixed bottom-10 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-6 py-3 rounded-full shadow-2xl font-bold text-sm z-[100] transition-opacity duration-300";
      toast.innerText = "권한이 성공적으로 변경되었습니다.";
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
      }, 2000);

      loadUsers(); // 성공 후 목록 갱신
    }
  } catch (err) {
    alert("서버 오류가 발생했습니다.");
    loadUsers();
  }
}

// 🔹 9. 새 부대원 수동 추가 (모달에서 사용)
async function addUser() {
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
      body: JSON.stringify({
        name,
        serviceNumber,
        email,
        role: "soldier", // 기본값은 용사
      }),
    });

    const result = await res.json();
    if (result.success) {
      alert("부대원이 성공적으로 추가되었습니다.");
      document.getElementById("newUserName").value = "";
      document.getElementById("newUserServiceNumber").value = "";
      document.getElementById("newUserGmail").value = "";

      // 모달 닫기
      if (typeof closeModal === "function") closeModal("userModal");

      loadUsers(); // 추가 후 즉시 리스트 갱신
    } else {
      alert(result.error || "추가에 실패했습니다.");
    }
  } catch (err) {
    alert("서버 통신 오류가 발생했습니다.");
  }
}

// 🔹 10. UI 헬퍼 함수 (사이드바 및 로그아웃)
function openSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (sidebar && overlay) {
    sidebar.classList.remove("-translate-x-full");
    overlay.classList.remove("hidden");
    setTimeout(() => overlay.classList.add("opacity-100"), 10);
  }
}

function closeSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (sidebar && overlay) {
    sidebar.classList.add("-translate-x-full");
    overlay.classList.remove("opacity-100");
    overlay.classList.add("opacity-0");
    setTimeout(() => overlay.classList.add("hidden"), 300);
  }
}

function logout() {
  if (confirm("로그아웃 하시겠습니까?")) {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    window.location.href = "login.html";
  }
}
