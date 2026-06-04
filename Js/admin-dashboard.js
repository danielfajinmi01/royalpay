import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
  addDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBt_MIilpDsOjRWjhP2HB-gAAg7Ikoa42E",
  authDomain: "royal-pay-c0609.firebaseapp.com",
  projectId: "royal-pay-c0609",
  storageBucket: "royal-pay-c0609.firebasestorage.app",
  messagingSenderId: "779187567401",
  appId: "1:779187567401:web:804afc6dd2bc8464d0d538"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── State ─────────────────────────────────────────────────────────────────────
let allUsers        = [];
let allApplications = [];
let allTx           = [];
let currentAdmin    = null;
let userFilter      = "all";
let appFilter       = "pending";
let pendingConfirm  = null;

// ── Format helpers ─────────────────────────────────────────────────────────────
const fmtCurrency = (v) => `$${Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const fmtDate = (ts) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const initials = (name = "") =>
  name.split(" ").filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = "info") {
  const icons = { success: "bi-check-circle-fill", error: "bi-x-circle-fill", info: "bi-info-circle-fill" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="bi ${icons[type]}"></i>${msg}`;
  document.getElementById("toastContainer").appendChild(el);
  setTimeout(() => { el.style.animation = "toastOut 0.3s ease forwards"; setTimeout(() => el.remove(), 350); }, 3500);
}

// ── Confirm modal ──────────────────────────────────────────────────────────────
const confirmModal  = document.getElementById("confirmModal");
const confirmTitle  = document.getElementById("confirmTitle");
const confirmMsg    = document.getElementById("confirmMessage");
const confirmOk     = document.getElementById("confirmOk");
const confirmCancel = document.getElementById("confirmCancel");
const confirmIcon   = document.getElementById("confirmIcon");

function confirm({ title, message, actionLabel, actionClass, danger = false, onConfirm }) {
  confirmTitle.textContent  = title;
  confirmMsg.textContent    = message;
  confirmOk.textContent     = actionLabel || "Confirm";
  confirmOk.className       = `btn-confirm-action ${actionClass || ""}`;
  confirmIcon.className     = `confirm-icon ${danger ? "danger" : ""}`;
  confirmModal.classList.add("show");
  pendingConfirm = onConfirm;
}

confirmOk.addEventListener("click", async () => {
  if (pendingConfirm) {
    confirmOk.disabled = true;
    await pendingConfirm();
    confirmOk.disabled = false;
  }
  closeConfirm();
});

confirmCancel.addEventListener("click", closeConfirm);
confirmModal.addEventListener("click", (e) => { if (e.target === confirmModal) closeConfirm(); });

function closeConfirm() {
  confirmModal.classList.remove("show");
  pendingConfirm = null;
}

// ── Auth guard ─────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "./admin-login.html"; return; }

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists() || snap.data().role !== "admin") {
    await signOut(auth);
    window.location.href = "./admin-login.html";
    return;
  }

  currentAdmin = { uid: user.uid, ...snap.data() };
  const name = currentAdmin.displayName || currentAdmin.firstName || "Admin";
  document.getElementById("adminName").textContent = name;
  document.getElementById("adminAvatarChip").textContent = initials(name);
  document.getElementById("adminAvatar").textContent = initials(name);

  await Promise.all([loadUsers(), loadApplications(), loadTransactions()]);
  renderOverview();
});

// ── Logout ─────────────────────────────────────────────────────────────────────
document.getElementById("adminLogoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "./admin-login.html";
});

// ── NAVIGATION ─────────────────────────────────────────────────────────────────
const navLinks = document.querySelectorAll(".nav-link");

navLinks.forEach(link => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const sec = link.dataset.section;
    showSection(sec);
    closeMobileMenu();
  });
});

document.querySelectorAll("[data-goto]").forEach(btn => {
  btn.addEventListener("click", () => showSection(btn.dataset.goto));
});

function showSection(sec) {
  document.querySelectorAll(".admin-section").forEach(s => s.classList.remove("active"));
  document.getElementById(`section-${sec}`).classList.add("active");

  navLinks.forEach(l => l.classList.toggle("active", l.dataset.section === sec));

  const titles = {
    overview:     ["System Overview",     "Monitoring all Royal Pay platform activity"],
    applications: ["Grant Applications",  "Review and action all pending applications"],
    users:        ["User Directory",       "Manage all registered platform users"],
    transactions: ["Audit Ledger",         "Full transaction history across all accounts"]
  };
  document.getElementById("pageTitle").textContent = titles[sec][0];
  document.getElementById("pageSub").textContent   = titles[sec][1];
}

// ── Mobile sidebar ─────────────────────────────────────────────────────────────
const sidebar        = document.getElementById("sidebar");
const hamburger      = document.getElementById("hamburger");
const sidebarOverlay = document.getElementById("sidebarOverlay");

hamburger.addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("show");
});

sidebarOverlay.addEventListener("click", closeMobileMenu);

function closeMobileMenu() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("show");
}

// ── LOAD DATA ─────────────────────────────────────────────────────────────────
async function loadUsers() {
  const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
  allUsers = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(u => u.role !== "admin");
  renderUsers();
}

async function loadApplications() {
  const snap = await getDocs(query(collection(db, "applications"), orderBy("createdAt", "desc")));
  allApplications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderApplications();
  updatePendingBadge();
}

async function loadTransactions() {
  const snap = await getDocs(query(collection(db, "transactions"), orderBy("createdAt", "desc")));
  allTx = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderTransactions();
}

// ── OVERVIEW ──────────────────────────────────────────────────────────────────
function renderOverview() {
  document.getElementById("statTotalUsers").textContent = allUsers.length;
  document.getElementById("statPending").textContent    = allApplications.filter(a => a.status === "pending").length;
  document.getElementById("statBanned").textContent     = allUsers.filter(u => u.status === "banned").length;

  const total = allUsers.reduce((s, u) => s + (u.walletBalance || 0), 0);
  document.getElementById("statAssets").textContent = fmtCurrency(total);

  // Mini pending list
  const container = document.getElementById("overviewAppList");
  const pending    = allApplications.filter(a => a.status === "pending").slice(0, 5);

  if (!pending.length) {
    container.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i><p>No pending applications</p></div>`;
    return;
  }

  container.innerHTML = pending.map(app => `
    <div class="app-mini-item">
      <div class="app-mini-avatar">${initials(app.applicantName || "?")}</div>
      <div class="app-mini-info">
        <strong>${app.applicantName || "Unknown"}</strong>
        <span>${app.category || "Grant"} · ${fmtDate(app.createdAt)}</span>
      </div>
      <span class="app-mini-amount">${fmtCurrency(app.amount)}</span>
    </div>
  `).join("");
}

function updatePendingBadge() {
  const count = allApplications.filter(a => a.status === "pending").length;
  const badge = document.getElementById("pendingBadge");
  badge.textContent = count;
  badge.style.display = count ? "inline-flex" : "none";
}

// ── APPLICATIONS TABLE ────────────────────────────────────────────────────────
document.querySelectorAll("[data-appfilter]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-appfilter]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    appFilter = btn.dataset.appfilter;
    renderApplications();
  });
});

document.getElementById("appSearchInput").addEventListener("input", renderApplications);

function renderApplications() {
  const q    = document.getElementById("appSearchInput").value.toLowerCase().trim();
  const tbody = document.getElementById("appTableBody");

  let list = appFilter === "all"
    ? allApplications
    : allApplications.filter(a => a.status === appFilter);

  if (q) {
    list = list.filter(a =>
      (a.applicantName || "").toLowerCase().includes(q) ||
      (a.accountNumber  || "").toLowerCase().includes(q) ||
      (a.category       || "").toLowerCase().includes(q)
    );
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty"><i class="bi bi-inbox" style="font-size:24px;display:block;margin-bottom:8px;opacity:.35"></i>No applications found</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(app => {
    const isProcessed = app.status !== "pending";
    const actions = isProcessed
      ? `<span class="status-badge ${app.status}">${app.status}</span>`
      : `<div class="action-btn-group">
           <button class="tbl-btn approve" onclick="approveApp('${app.id}','${app.applicantUid}', ${app.amount})">
             <i class="bi bi-check-lg"></i> Approve
           </button>
           <button class="tbl-btn decline" onclick="declineApp('${app.id}')">
             <i class="bi bi-x-lg"></i> Decline
           </button>
         </div>`;
    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-mini-avatar">${initials(app.applicantName || "?")}</div>
            <div class="user-cell-info">
              <strong>${app.applicantName || "Unknown"}</strong>
              <span>${app.applicantEmail || ""}</span>
            </div>
          </div>
        </td>
        <td><span class="mono">${app.accountNumber || "—"}</span></td>
        <td>${app.category || "General Grant"}</td>
        <td>${fmtCurrency(app.amount)}</td>
        <td>${fmtDate(app.createdAt)}</td>
        <td><span class="status-badge ${app.status}">${app.status}</span></td>
        <td class="text-center">${actions}</td>
      </tr>`;
  }).join("");
}

// Expose to global scope for inline onclick
window.approveApp = async (appId, applicantUid, amount) => {
  confirm({
    title: "Approve Application?",
    message: `This will credit ${fmtCurrency(amount)} to the applicant's wallet immediately.`,
    actionLabel: "Yes, Approve",
    actionClass: "approve",
    danger: false,
    onConfirm: async () => {
      try {
        // Credit the user's wallet
        const userRef  = doc(db, "users", applicantUid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) { toast("User account not found", "error"); return; }

        const currentBal = userSnap.data().walletBalance || 0;
        await updateDoc(userRef, { walletBalance: currentBal + Number(amount) });

        // Mark application approved
        await updateDoc(doc(db, "applications", appId), {
          status:    "approved",
          reviewedAt: serverTimestamp(),
          reviewedBy: currentAdmin.uid
        });

        // Add a credit transaction
        await addDoc(collection(db, "transactions"), {
          type:          "grant",
          description:   "Grant application approved",
          amount:        Number(amount),
          accountNumber: userSnap.data().accountNumber,
          uid:           applicantUid,
          createdAt:     serverTimestamp(),
          reference:     `GRT-${Date.now()}`,
          status:        "success",
          approvedBy:    currentAdmin.uid
        });

        // Update local state
        const idx = allApplications.findIndex(a => a.id === appId);
        if (idx !== -1) allApplications[idx] = { ...allApplications[idx], status: "approved" };

        // Update user balance in local state
        const ui = allUsers.findIndex(u => u.id === applicantUid);
        if (ui !== -1) allUsers[ui].walletBalance = currentBal + Number(amount);

        renderApplications();
        renderOverview();
        updatePendingBadge();
        toast(`Application approved — ${fmtCurrency(amount)} credited`, "success");
      } catch (err) {
        console.error(err);
        toast("Failed to approve application. Please try again.", "error");
      }
    }
  });
};

window.declineApp = async (appId) => {
  confirm({
    title: "Decline Application?",
    message: "The applicant will not receive any funds. This action is permanent.",
    actionLabel: "Yes, Decline",
    danger: true,
    onConfirm: async () => {
      try {
        await updateDoc(doc(db, "applications", appId), {
          status:     "declined",
          reviewedAt:  serverTimestamp(),
          reviewedBy:  currentAdmin.uid
        });

        const idx = allApplications.findIndex(a => a.id === appId);
        if (idx !== -1) allApplications[idx] = { ...allApplications[idx], status: "declined" };

        renderApplications();
        renderOverview();
        updatePendingBadge();
        toast("Application declined", "info");
      } catch (err) {
        console.error(err);
        toast("Failed to decline application.", "error");
      }
    }
  });
};

// ── USER TABLE ────────────────────────────────────────────────────────────────
document.querySelectorAll("[data-userfilter]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-userfilter]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    userFilter = btn.dataset.userfilter;
    renderUsers();
  });
});

document.getElementById("userSearchInput").addEventListener("input", renderUsers);

function renderUsers() {
  const q     = document.getElementById("userSearchInput").value.toLowerCase().trim();
  const tbody = document.getElementById("userTableBody");

  let list = userFilter === "all"
    ? allUsers
    : allUsers.filter(u => u.status === userFilter);

  if (q) {
    list = list.filter(u =>
      (u.firstName || "").toLowerCase().includes(q) ||
      (u.lastName  || "").toLowerCase().includes(q) ||
      (u.email     || "").toLowerCase().includes(q) ||
      (u.accountNumber || "").toLowerCase().includes(q)
    );
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty"><i class="bi bi-people" style="font-size:24px;display:block;margin-bottom:8px;opacity:.35"></i>No users found</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(u => {
    const isBanned  = u.status === "banned";
    const fullName  = `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Unknown";
    const banBtn    = isBanned
      ? `<button class="tbl-btn unban"  onclick="toggleBan('${u.id}', false, '${escHtml(fullName)}')"><i class="bi bi-check-circle"></i> Unban</button>`
      : `<button class="tbl-btn ban"    onclick="toggleBan('${u.id}', true,  '${escHtml(fullName)}')"><i class="bi bi-slash-circle"></i> Ban</button>`;
    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-mini-avatar">${initials(fullName)}</div>
            <div class="user-cell-info">
              <strong>${fullName}</strong>
            </div>
          </div>
        </td>
        <td><span class="mono">${u.accountNumber || "—"}</span></td>
        <td>${u.email || "—"}</td>
        <td>${fmtCurrency(u.walletBalance)}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td><span class="status-badge ${u.status || "active"}">${u.status || "active"}</span></td>
        <td class="text-center">
          <div class="action-btn-group">
            ${banBtn}
            <button class="tbl-btn delete" onclick="deleteUser('${u.id}', '${escHtml(fullName)}')">
              <i class="bi bi-trash3"></i> Delete
            </button>
          </div>
        </td>
      </tr>`;
  }).join("");
}

function escHtml(s) { return s.replace(/'/g, "\\'"); }

window.toggleBan = async (uid, ban, name) => {
  confirm({
    title: ban ? `Ban ${name}?` : `Unban ${name}?`,
    message: ban
      ? "This user will be blocked from logging in immediately."
      : "This user will regain access to their account.",
    actionLabel: ban ? "Yes, Ban User" : "Yes, Unban",
    danger: ban,
    actionClass: ban ? "" : "approve",
    onConfirm: async () => {
      try {
        await updateDoc(doc(db, "users", uid), {
          status: ban ? "banned" : "active",
          bannedAt: ban ? serverTimestamp() : null,
          bannedBy: ban ? currentAdmin.uid : null
        });

        const i = allUsers.findIndex(u => u.id === uid);
        if (i !== -1) allUsers[i].status = ban ? "banned" : "active";

        renderUsers();
        renderOverview();
        toast(ban ? `${name} has been banned.` : `${name} has been unbanned.`, ban ? "error" : "success");
      } catch (err) {
        console.error(err);
        toast("Action failed. Please try again.", "error");
      }
    }
  });
};

window.deleteUser = async (uid, name) => {
  confirm({
    title: `Delete ${name}?`,
    message: "All user data will be permanently removed. This cannot be undone.",
    actionLabel: "Delete Permanently",
    danger: true,
    onConfirm: async () => {
      try {
        await deleteDoc(doc(db, "users", uid));
        allUsers = allUsers.filter(u => u.id !== uid);
        renderUsers();
        renderOverview();
        toast(`${name}'s account deleted.`, "error");
      } catch (err) {
        console.error(err);
        toast("Failed to delete user.", "error");
      }
    }
  });
};

// ── TRANSACTIONS TABLE ────────────────────────────────────────────────────────
document.getElementById("txSearchInput").addEventListener("input", renderTransactions);

function renderTransactions() {
  const q     = document.getElementById("txSearchInput").value.toLowerCase().trim();
  const tbody = document.getElementById("txTableBody");

  let list = q ? allTx.filter(t =>
    (t.reference    || "").toLowerCase().includes(q) ||
    (t.accountNumber || "").toLowerCase().includes(q) ||
    (t.description  || "").toLowerCase().includes(q) ||
    (t.type         || "").toLowerCase().includes(q)
  ) : allTx;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty"><i class="bi bi-receipt" style="font-size:24px;display:block;margin-bottom:8px;opacity:.35"></i>No transactions found</td></tr>`;
    return;
  }

  tbody.innerHTML = list.slice(0, 200).map(t => {
    const typeIcons = {
      transfer: "bi-arrow-left-right",
      grant:    "bi-award",
      credit:   "bi-arrow-down-circle",
      debit:    "bi-arrow-up-circle"
    };
    const icon      = typeIcons[t.type] || "bi-circle";
    const isDebit   = t.type === "transfer" || t.type === "debit";
    const amtClass  = isDebit ? "color:#ef4444" : "color:#10b981";
    const amtSign   = isDebit ? "-" : "+";

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <i class="bi ${icon}" style="font-size:16px;color:var(--purple-lt)"></i>
            <span style="text-transform:capitalize;font-weight:700">${t.type || "—"}</span>
          </div>
        </td>
        <td><span class="mono">${t.reference || "—"}</span></td>
        <td><span class="mono">${t.accountNumber || t.senderAccount || "—"}</span></td>
        <td><span class="mono">${t.receiverAccount || "—"}</span></td>
        <td>${fmtDate(t.createdAt)}</td>
        <td class="text-right" style="${amtClass};font-weight:900">${amtSign}${fmtCurrency(t.amount)}</td>
      </tr>`;
  }).join("");
}
