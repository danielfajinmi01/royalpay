import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  getDocs,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Firebase Config ───────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyBt_MIilpDsOjRWjhP2HB-gAAg7Ikoa42E",
  authDomain:        "royal-pay-c0609.firebaseapp.com",
  projectId:         "royal-pay-c0609",
  storageBucket:     "royal-pay-c0609.firebasestorage.app",
  messagingSenderId: "779187567401",
  appId:             "1:779187567401:web:804afc6dd2bc8464d0d538"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─── App State ─────────────────────────────────────────────────────────────────
let currentUserDoc   = null;
let activeFilter     = "all";
let rawTransactions  = [];
let selectedCurrency = "USD";
let txMap            = {};   // keyed by transaction ID for quick detail lookup
let isBalanceVisible = true;

const exchangeRates = {
  USD:  1,
  NGN:  1500,
  BTC:  0.0000146,
  ETH:  0.000267,
  USDT: 1
};

// ─── Auth Guard (with banned-user check) ──────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists() && snap.data().status === "banned") {
      await signOut(auth);
      window.location.href = "./login.html?error=banned";
      return;
    }
  } catch (_) { /* proceed */ }
  initializeDashboard(user);
});

// ─── Initialize Dashboard ──────────────────────────────────────────────────────
function initializeDashboard(user) {
  fetchRates();
  setInterval(fetchRates, 60000);

  const userRef = doc(db, "users", user.uid);
  onSnapshot(userRef, (snapshot) => {
    if (!snapshot.exists()) return;
    currentUserDoc = snapshot.data();

    const missing = {};
    if (currentUserDoc.btcBalance  === undefined) missing.btcBalance  = 0;
    if (currentUserDoc.ethBalance  === undefined) missing.ethBalance  = 0;
    if (currentUserDoc.usdtBalance === undefined) missing.usdtBalance = 0;
    if (Object.keys(missing).length) updateDoc(userRef, missing);

    updateUserUI(currentUserDoc);
    autofillForms(currentUserDoc);
  });

  const txQuery = query(
    collection(db, "transactions"),
    where("involvedParties", "array-contains", user.uid)
  );
  onSnapshot(txQuery, (snapshot) => {
    rawTransactions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    rawTransactions.sort((a, b) => {
      const tA = a.timestamp?.seconds || a.createdAt?.seconds || 0;
      const tB = b.timestamp?.seconds || b.createdAt?.seconds || 0;
      return tB - tA;
    });
    renderTransactions(rawTransactions);
    renderActivityLog(rawTransactions);
  });
}

// ─── Fetch Live Crypto Rates ───────────────────────────────────────────────────
async function fetchRates() {
  const triggerPulse = (id) => {
    const el = document.getElementById(id);
    if (el) {
      const pill = el.closest(".ticker-pill");
      if (pill) {
        pill.classList.remove("pulse-update");
        void pill.offsetWidth; // force reflow
        pill.classList.add("pulse-update");
      }
    }
  };

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd,ngn"
    );
    if (!res.ok) throw new Error("Rate fetch failed");
    const data = await res.json();

    const btcUSD  = data.bitcoin.usd;
    const ethUSD  = data.ethereum.usd;
    const usdtUSD = data.tether.usd;
    const ngnRate = data.bitcoin.ngn / btcUSD;

    exchangeRates.BTC  = 1 / btcUSD;
    exchangeRates.ETH  = 1 / ethUSD;
    exchangeRates.USDT = 1 / usdtUSD;
    exchangeRates.NGN  = ngnRate || 1500;

    document.getElementById("tickerBTC").textContent  = `$${btcUSD.toLocaleString()}`;
    triggerPulse("tickerBTC");
    document.getElementById("tickerETH").textContent  = `$${ethUSD.toLocaleString()}`;
    triggerPulse("tickerETH");
    document.getElementById("tickerUSDT").textContent = `$${usdtUSD.toFixed(4)}`;
    triggerPulse("tickerUSDT");

    if (currentUserDoc) updateUserUI(currentUserDoc);
  } catch (_) {
    document.getElementById("tickerBTC").textContent  = "$68,500 (est.)";
    triggerPulse("tickerBTC");
    document.getElementById("tickerETH").textContent  = "$3,750 (est.)";
    triggerPulse("tickerETH");
    document.getElementById("tickerUSDT").textContent = "$1.00";
    triggerPulse("tickerUSDT");
  }
}

// ─── Format Currency ───────────────────────────────────────────────────────────
function formatValue(valueUSD, currency) {
  const converted = valueUSD * exchangeRates[currency];
  switch (currency) {
    case "NGN":  return `₦${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "BTC":  return `₿${converted.toFixed(6)}`;
    case "ETH":  return `Ξ${converted.toFixed(5)}`;
    case "USDT": return `₮${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    default:     return `$${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

// ─── Update User UI ───────────────────────────────────────────────────────────
function updateUserUI(data) {
  const fullName = data.displayName ||
    `${data.firstName || ""} ${data.lastName || ""}`.trim() || "Royal Pay User";

  document.getElementById("userNameLabel").textContent = fullName;

  // ── Calculate dynamic greeting based on hour ──
  const hour = new Date().getHours();
  let greeting = "Welcome back";
  if (hour >= 5 && hour < 12) greeting = "Good morning";
  else if (hour >= 12 && hour < 18) greeting = "Good afternoon";
  else greeting = "Good evening";

  const firstName = data.firstName || data.displayName?.split(" ")[0] || "User";

  const dashboardGreeting = document.getElementById("dashboardGreeting");
  const dashboardUserName = document.getElementById("dashboardUserName");
  if (dashboardGreeting) dashboardGreeting.textContent = `${greeting},`;
  if (dashboardUserName) dashboardUserName.textContent = firstName;

  const avatarPlaceholder = document.getElementById("avatarPlaceholder");
  const userAvatar        = document.getElementById("userAvatar");
  if (data.photoURL) {
    userAvatar.src                  = data.photoURL;
    userAvatar.style.display        = "block";
    avatarPlaceholder.style.display = "none";
  } else {
    avatarPlaceholder.textContent   = fullName.charAt(0).toUpperCase();
    avatarPlaceholder.style.display = "grid";
    userAvatar.style.display        = "none";
  }

  document.getElementById("displayAccountNumber").textContent = data.accountNumber || "PENDING";
  document.getElementById("metaEmail").textContent = data.email || "Not set";
  if (data.createdAt) {
    const d = new Date(data.createdAt.seconds * 1000);
    document.getElementById("metaJoined").textContent =
      d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } else {
    document.getElementById("metaJoined").textContent = "Instant Setup";
  }

  const usdBal  = data.walletBalance || 0;
  const btcBal  = data.btcBalance    || 0;
  const ethBal  = data.ethBalance    || 0;
  const usdtBal = data.usdtBalance   || 0;

  const maskValue = (val, formatter) => {
    return isBalanceVisible ? formatter(val) : "••••••";
  };

  document.getElementById("usdWalletVal").textContent = maskValue(usdBal, v =>
    `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  document.getElementById("btcWalletVal").textContent = maskValue(btcBal, v => `${v.toFixed(5)} BTC`);
  document.getElementById("ethWalletVal").textContent = maskValue(ethBal, v => `${v.toFixed(4)} ETH`);
  document.getElementById("usdtWalletVal").textContent = maskValue(usdtBal, v =>
    `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`);

  const totalUSD =
    usdBal +
    (btcBal  / exchangeRates.BTC) +
    (ethBal  / exchangeRates.ETH) +
    (usdtBal / exchangeRates.USDT);

  const formattedTotal = formatValue(totalUSD, selectedCurrency);
  document.getElementById("totalBalanceUSD").textContent = isBalanceVisible ? formattedTotal : "••••••";

  // ── Fade out injected loader overlay ──
  const loader = document.getElementById("dashboardLoader");
  if (loader && !loader.classList.contains("fade-out")) {
    setTimeout(() => {
      loader.classList.add("fade-out");
    }, 600);
  }
}

// ─── Autofill Grant & Profile Forms ───────────────────────────────────────────
function autofillForms(data) {
  const grantName = document.getElementById("grantName");
  const grantAcc  = document.getElementById("grantAccountNumber");
  if (grantName) grantName.value = data.displayName || `${data.firstName || ""} ${data.lastName || ""}`.trim();
  if (grantAcc)  grantAcc.value  = data.accountNumber || "";

  const pFirst = document.getElementById("profileFirstName");
  const pLast  = document.getElementById("profileLastName");
  const pPhone = document.getElementById("profilePhone");
  const pBio   = document.getElementById("profileBio");
  if (pFirst && !pFirst.value) pFirst.value = data.firstName || "";
  if (pLast  && !pLast.value)  pLast.value  = data.lastName  || "";
  if (pPhone && !pPhone.value) pPhone.value = data.phone     || "";
  if (pBio   && !pBio.value)   pBio.value   = data.bio       || "";
}

// ─── Determine Transaction Direction ─────────────────────────────────────────
// Returns an object: { direction, iconClass, statusClass, amtPrefix, amtClass, badgeClass, badgeLabel }
function getTxDirection(tx) {
  const uid = auth.currentUser?.uid;

  if (tx.type === "deposit") {
    return {
      direction: "credit", iconClass: "bi-wallet2", statusClass: "received",
      amtPrefix: "+", amtClass: "plus", badgeClass: "badge-credit", badgeLabel: "CREDIT"
    };
  }
  if (tx.type === "grant") {
    return {
      direction: "credit", iconClass: "bi-award-fill", statusClass: "grant",
      amtPrefix: "+", amtClass: "plus", badgeClass: "badge-credit", badgeLabel: "CREDIT"
    };
  }
  if (tx.type === "conversion") {
    return {
      direction: "convert", iconClass: "bi-arrow-left-right", statusClass: "convert",
      amtPrefix: "⇌", amtClass: "plus", badgeClass: "badge-convert", badgeLabel: "CONVERT"
    };
  }
  if (tx.type === "transfer") {
    if (tx.receiverUid === uid) {
      return {
        direction: "credit", iconClass: "bi-arrow-down-left", statusClass: "received",
        amtPrefix: "+", amtClass: "plus", badgeClass: "badge-credit", badgeLabel: "CREDIT"
      };
    }
    return {
      direction: "debit", iconClass: "bi-arrow-up-right", statusClass: "sent",
      amtPrefix: "−", amtClass: "minus", badgeClass: "badge-debit", badgeLabel: "DEBIT"
    };
  }
  // Fallback
  return {
    direction: "debit", iconClass: "bi-circle", statusClass: "sent",
    amtPrefix: "−", amtClass: "minus", badgeClass: "badge-debit", badgeLabel: "DEBIT"
  };
}

// ─── Format Transaction Timestamp ────────────────────────────────────────────
function formatTxDate(tx, opts = {}) {
  const ts   = tx.timestamp || tx.createdAt;
  const date = ts?.seconds ? new Date(ts.seconds * 1000) : (ts ? new Date(ts) : null);
  if (!date || isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, opts);
}

// ─── Render Transaction Table ─────────────────────────────────────────────────
function renderTransactions(txs) {
  const tbody  = document.getElementById("txTableBody");
  const search = document.getElementById("txSearchInput").value.trim().toLowerCase();

  // Rebuild lookup map on every render
  txMap = {};

  const filtered = txs.filter(tx => {
    if (activeFilter !== "all" && tx.type !== activeFilter) return false;
    if (search) {
      return (
        (tx.reference      || "").toLowerCase().includes(search) ||
        (tx.description    || "").toLowerCase().includes(search) ||
        (tx.senderAccount  || "").includes(search) ||
        (tx.receiverAccount|| "").includes(search)
      );
    }
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No transactions match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(tx => {
    txMap[tx.id] = tx;  // store for click detail

    const dir = getTxDirection(tx);

    const shortDate = formatTxDate(tx, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });

    const amtFormatted = `${dir.amtPrefix} $${(tx.amount || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    })}`;

    return `<tr class="tx-row" data-txid="${tx.id}" title="Click to view details">
      <td>
        <div class="tx-type-cell">
          <span class="tx-icon-ind ${dir.statusClass}"><i class="bi ${dir.iconClass}"></i></span>
        </div>
      </td>
      <td>
        <div class="tx-details-cell">
          <span class="tx-desc-cell">${tx.description || "—"}</span>
          <span class="tx-ref-cell">${tx.reference || "N/A"}</span>
        </div>
      </td>
      <td><span class="tx-date-cell">${shortDate}</span></td>
      <td class="text-right">
        <div class="tx-amt-badge-wrap">
          <span class="tx-amt-cell ${dir.amtClass}">${amtFormatted}</span>
          <span class="tx-dir-badge ${dir.badgeClass}">${dir.badgeLabel}</span>
        </div>
      </td>
    </tr>`;
  }).join("");
}

// ─── Show Transaction Detail Modal ───────────────────────────────────────────
function showTransactionDetail(tx) {
  if (!tx) return;

  const dir = getTxDirection(tx);

  const fullDate = formatTxDate(tx, {
    weekday: "short", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });

  const amtFormatted = `${dir.amtPrefix} $${(tx.amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })}`;

  const typeIcons = {
    transfer:   "bi-arrow-left-right",
    deposit:    "bi-wallet2",
    grant:      "bi-award-fill",
    conversion: "bi-shuffle"
  };
  const typeIcon = typeIcons[tx.type] || "bi-circle";

  document.getElementById("txDetailBody").innerHTML = `
    <div class="tx-detail-hero">
      <span class="tx-detail-dir-badge ${dir.badgeClass}">${dir.badgeLabel}</span>
      <div class="tx-detail-amount ${dir.amtClass}">${amtFormatted}</div>
      <div class="tx-detail-type-label">
        <i class="bi ${typeIcon}"></i>
        ${(tx.type || "Transaction").charAt(0).toUpperCase() + (tx.type || "").slice(1)}
      </div>
    </div>

    <div class="tx-detail-rows">
      <div class="tx-detail-row">
        <span class="tx-detail-lbl">Reference</span>
        <span class="tx-detail-val mono">${tx.reference || "N/A"}</span>
      </div>
      <div class="tx-detail-row">
        <span class="tx-detail-lbl">Date &amp; Time</span>
        <span class="tx-detail-val">${fullDate || "—"}</span>
      </div>
      <div class="tx-detail-row">
        <span class="tx-detail-lbl">Description</span>
        <span class="tx-detail-val">${tx.description || "—"}</span>
      </div>
    </div>

    <div class="tx-detail-parties">
      <div class="tx-party-block">
        <span class="tx-party-lbl">From</span>
        <span class="tx-party-name">${tx.senderName || "Royal Pay System"}</span>
        <span class="tx-party-acc mono">${tx.senderAccount || "—"}</span>
      </div>
      <div class="tx-party-arrow"><i class="bi bi-arrow-right-circle-fill"></i></div>
      <div class="tx-party-block tx-party-right">
        <span class="tx-party-lbl">To</span>
        <span class="tx-party-name">${tx.receiverName || "—"}</span>
        <span class="tx-party-acc mono">${tx.receiverAccount || "—"}</span>
      </div>
    </div>
  `;

  openModal("txDetailModal");
}

// ─── Render Activity Log ──────────────────────────────────────────────────────
function renderActivityLog(txs) {
  const container = document.getElementById("notifList");
  const recent    = txs.slice(0, 4);
  const uid       = auth.currentUser?.uid;

  if (!recent.length) {
    container.innerHTML = `<div class="notif-placeholder">No recent activity yet.</div>`;
    return;
  }

  container.innerHTML = recent.map(tx => {
    const isIncoming = tx.receiverUid === uid;
    let typeClass = "warning";
    let logMsg    = tx.description || "Transaction";

    if (tx.type === "deposit")  { typeClass = "success"; logMsg = `Demo funds added: $${(tx.amount || 0).toLocaleString()}`; }
    else if (tx.type === "grant")     { typeClass = "success"; logMsg = `Grant submitted: $${(tx.amount || 0).toLocaleString()}`; }
    else if (tx.type === "conversion"){ typeClass = "success"; logMsg = tx.description || "Crypto conversion"; }
    else if (tx.type === "transfer") {
      if (isIncoming) { typeClass = "success"; logMsg = `Received $${(tx.amount || 0).toLocaleString()} from Acc …${(tx.senderAccount || "????").slice(-4)}`; }
      else            { typeClass = "warning";  logMsg = `Sent $${(tx.amount || 0).toLocaleString()} to Acc …${(tx.receiverAccount || "????").slice(-4)}`; }
    }

    const ts   = tx.timestamp || tx.createdAt;
    const time = ts?.seconds
      ? new Date(ts.seconds * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : "";

    return `<div class="notif-item ${typeClass}">
      <span>${logMsg}</span>
      <span class="notif-time">${time}</span>
    </div>`;
  }).join("");
}

// ─── Modal Helpers ────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add("show");
}
function closeModal(id) {
  const overlay = document.getElementById(id);
  overlay.classList.remove("show");
  const form = overlay.querySelector("form");
  if (form) form.reset();
  const err = overlay.querySelector(".modal-error-banner");
  if (err) { err.classList.remove("show"); err.textContent = ""; }
}

document.querySelectorAll("[data-modal-close]").forEach(btn => {
  btn.addEventListener("click", e => {
    closeModal(e.target.closest(".modal-overlay").id);
  });
});

document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ─── Transaction Row Click → Detail Modal ─────────────────────────────────────
document.getElementById("txTableBody").addEventListener("click", e => {
  const row = e.target.closest("tr[data-txid]");
  if (row && txMap[row.dataset.txid]) {
    showTransactionDetail(txMap[row.dataset.txid]);
  }
});

// ─── Open Modal Buttons ───────────────────────────────────────────────────────
document.getElementById("openTransferModal").addEventListener("click", () => {
  const nameEl = document.getElementById("transferReceiverName");
  const btnEl  = document.getElementById("transferSubmitBtn");
  const inputEl = document.getElementById("transferReceiver");
  if (nameEl)  { nameEl.textContent = ""; nameEl.classList.remove("error"); }
  if (btnEl)   btnEl.disabled = true;
  if (inputEl) inputEl.value = "";
  openModal("transferModal");
});

document.getElementById("openDepositModal").addEventListener("click", () => {
  openModal("depositModal");
});

document.getElementById("openExchangeModal").addEventListener("click", () => {
  updateExchangeModalBalances();
  openModal("exchangeModal");
});

document.getElementById("openGrantModal").addEventListener("click", () => {
  const formEl = document.getElementById("grantFormSection");
  const procEl = document.getElementById("grantProcessingSection");
  const succEl = document.getElementById("grantSuccessSection");
  if (formEl) formEl.style.display = "block";
  if (procEl) procEl.style.display = "none";
  if (succEl) succEl.style.display = "none";
  if (currentUserDoc) autofillForms(currentUserDoc);
  openModal("grantModal");
});

document.getElementById("editProfileBtn").addEventListener("click", () => {
  openModal("profileModal");
});

// ─── Copy Account Number ──────────────────────────────────────────────────────
document.getElementById("copyAccBtn").addEventListener("click", () => {
  const num = document.getElementById("displayAccountNumber").textContent;
  navigator.clipboard.writeText(num).then(() => {
    const btn = document.getElementById("copyAccBtn");
    btn.innerHTML = `<i class="bi bi-check-lg" style="color:white;"></i>`;
    btn.style.backgroundColor = "var(--mint)";
    setTimeout(() => {
      btn.innerHTML = `<i class="bi bi-copy"></i>`;
      btn.style.backgroundColor = "";
    }, 2000);
  });
});

// ─── Currency Switcher ────────────────────────────────────────────────────────
document.getElementById("displayCurrency").addEventListener("change", e => {
  selectedCurrency = e.target.value;
  if (currentUserDoc) updateUserUI(currentUserDoc);
});

// ─── Balance Visibility Toggle ────────────────────────────────────────────────
const toggleBalBtn = document.getElementById("toggleBalanceVisibility");
if (toggleBalBtn) {
  toggleBalBtn.addEventListener("click", () => {
    isBalanceVisible = !isBalanceVisible;
    toggleBalBtn.innerHTML = isBalanceVisible ? '<i class="bi bi-eye"></i>' : '<i class="bi bi-eye-slash"></i>';
    if (currentUserDoc) updateUserUI(currentUserDoc);
  });
}

// ─── Dropdown Toggle ──────────────────────────────────────────────────────────
const dropdown = document.getElementById("userDropdown");
document.getElementById("userMenuTrigger").addEventListener("click", e => {
  e.stopPropagation();
  dropdown.classList.toggle("show");
  document.getElementById("userMenuTrigger").querySelector("i").style.transform =
    dropdown.classList.contains("show") ? "rotate(180deg)" : "rotate(0)";
});
document.addEventListener("click", () => {
  dropdown.classList.remove("show");
  const chevron = document.getElementById("userMenuTrigger").querySelector("i");
  if (chevron) chevron.style.transform = "rotate(0)";
});

// ─── Logout ───────────────────────────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "./login.html";
});

// ─── Transaction Filters & Search ────────────────────────────────────────────
document.getElementById("txSearchInput").addEventListener("input", () => renderTransactions(rawTransactions));

document.querySelectorAll(".filter-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    activeFilter = tab.dataset.filter;
    renderTransactions(rawTransactions);
  });
});

// ══════════════════════════════════════════════════════════════
// TRANSFER MONEY — with live recipient verification
// ══════════════════════════════════════════════════════════════
let lookupTimeout = null;

const transferReceiverInput = document.getElementById("transferReceiver");
if (transferReceiverInput) {
  transferReceiverInput.addEventListener("input", e => {
    const val       = e.target.value.trim();
    const nameLabel = document.getElementById("transferReceiverName");
    const submitBtn = document.getElementById("transferSubmitBtn");
    const spinner   = document.getElementById("transferVerificationSpinner");

    if (nameLabel) { nameLabel.textContent = ""; nameLabel.classList.remove("error"); }
    if (submitBtn)   submitBtn.disabled = true;

    // Only start lookup when 10 digits are entered
    if (val.length < 10) {
      if (spinner) spinner.style.display = "none";
      return;
    }

    clearTimeout(lookupTimeout);
    if (spinner) spinner.style.display = "block";

    lookupTimeout = setTimeout(async () => {
      try {
        const q    = query(collection(db, "users"), where("accountNumber", "==", val));
        const snap = await getDocs(q);
        if (spinner) spinner.style.display = "none";

        if (!snap.empty) {
          const receiver = snap.docs[0].data();
          if (receiver.uid === auth.currentUser.uid) {
            if (nameLabel) {
              nameLabel.textContent = "✕ You cannot transfer to your own account.";
              nameLabel.classList.add("error");
            }
          } else if (receiver.status === "banned") {
            if (nameLabel) {
              nameLabel.textContent = "✕ This account is not available.";
              nameLabel.classList.add("error");
            }
          } else {
            const recipientName = receiver.displayName ||
              `${receiver.firstName || ""} ${receiver.lastName || ""}`.trim() || "Royal Pay User";
            if (nameLabel) {
              nameLabel.textContent = `✓ Recipient: ${recipientName}`;
              nameLabel.classList.remove("error");
            }
            if (submitBtn) submitBtn.disabled = false;
          }
        } else {
          if (nameLabel) {
            nameLabel.textContent = "✕ Account number not found.";
            nameLabel.classList.add("error");
          }
        }
      } catch (err) {
        if (spinner) spinner.style.display = "none";
        if (nameLabel) {
          nameLabel.textContent = "✕ Error verifying recipient. Try again.";
          nameLabel.classList.add("error");
        }
      }
    }, 500);
  });
}

const transferFormEl = document.getElementById("transferForm");
if (transferFormEl) transferFormEl.addEventListener("submit", async e => {
  e.preventDefault();
  const errorEl   = document.getElementById("transferError");
  const submitBtn = document.getElementById("transferSubmitBtn");
  if (errorEl) { errorEl.classList.remove("show"); errorEl.textContent = ""; }

  // Read from the correct ID: transferReceiver (not transferRecipient)
  const receiverAcc = document.getElementById("transferReceiver")?.value.trim() || "";
  const amount      = parseFloat(document.getElementById("transferAmount")?.value || "0");
  const note        = document.getElementById("transferNote")?.value.trim() || "";

  if (!receiverAcc || receiverAcc.length < 10 || isNaN(amount) || amount <= 0) {
    if (errorEl) { errorEl.textContent = "Please enter a valid 10-digit recipient and amount."; errorEl.classList.add("show"); }
    return;
  }

  const senderBal = currentUserDoc?.walletBalance || 0;
  if (amount > senderBal) {
    if (errorEl) {
      errorEl.textContent = `Insufficient balance. Available: $${senderBal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      errorEl.classList.add("show");
    }
    return;
  }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Processing…"; }

  try {
    const q    = query(collection(db, "users"), where("accountNumber", "==", receiverAcc));
    const snap = await getDocs(q);

    if (snap.empty) throw new Error("Recipient account not found.");

    const receiverData = snap.docs[0].data();

    if (receiverData.uid === auth.currentUser.uid) throw new Error("You cannot transfer to your own account.");

    await updateDoc(doc(db, "users", auth.currentUser.uid), {
      walletBalance: senderBal - amount
    });

    await updateDoc(doc(db, "users", receiverData.uid), {
      walletBalance: (receiverData.walletBalance || 0) + amount
    });

    const txRef = `RP-TX-${Math.floor(100000 + Math.random() * 900000)}`;
    await addDoc(collection(db, "transactions"), {
      type:            "transfer",
      amount,
      description:     note ? `Transfer: ${note}` : `Sent to ${receiverData.displayName || receiverData.firstName || "user"}`,
      senderUid:       auth.currentUser.uid,
      senderAccount:   currentUserDoc.accountNumber,
      senderName:      currentUserDoc.displayName || `${currentUserDoc.firstName} ${currentUserDoc.lastName}`,
      receiverUid:     receiverData.uid,
      receiverAccount: receiverData.accountNumber,
      receiverName:    receiverData.displayName || `${receiverData.firstName} ${receiverData.lastName}`,
      involvedParties: [auth.currentUser.uid, receiverData.uid],
      reference:       txRef,
      timestamp:       serverTimestamp()
    });

    if (submitBtn) {
      submitBtn.textContent = "✔ Successful";
      submitBtn.style.backgroundColor = "#10b981"; // Mint green
      submitBtn.style.color = "white";
    }

    setTimeout(() => {
      closeModal("transferModal");
      if (submitBtn) {
        submitBtn.textContent = "Send Money";
        submitBtn.style.backgroundColor = "";
        submitBtn.style.color = "";
      }
    }, 1500);

  } catch (err) {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Send Money"; }
    if (errorEl)   { errorEl.textContent = err.message || "Transfer failed. Please try again."; errorEl.classList.add("show"); }
  }
});

// ══════════════════════════════════════════════════════════════
// DEPOSIT / ADD FUNDS
// ══════════════════════════════════════════════════════════════
document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("customDepositAmount").value = btn.dataset.amount;
  });
});

document.getElementById("customDepositAmount").addEventListener("input", () => {
  document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active"));
});

document.getElementById("depositForm").addEventListener("submit", async e => {
  e.preventDefault();
  const errorEl   = document.getElementById("depositError");
  const submitBtn = document.getElementById("depositSubmitBtn");
  const amount    = parseFloat(document.getElementById("customDepositAmount").value);

  errorEl.classList.remove("show");
  if (isNaN(amount) || amount <= 0) {
    errorEl.textContent = "Please select or enter a valid amount.";
    errorEl.classList.add("show");
    return;
  }

  submitBtn.disabled    = true;
  submitBtn.textContent = "Crediting Wallet…";

  try {
    await updateDoc(doc(db, "users", auth.currentUser.uid), {
      walletBalance: (currentUserDoc.walletBalance || 0) + amount
    });

    const txRef = `RP-DEP-${Math.floor(100000 + Math.random() * 900000)}`;
    await addDoc(collection(db, "transactions"), {
      type:            "deposit",
      amount,
      description:     `Demo deposit — $${amount.toLocaleString()} credited`,
      senderUid:       "SYSTEM",
      senderAccount:   "0000000000",
      senderName:      "Royal Pay Ledger System",
      receiverUid:     auth.currentUser.uid,
      receiverAccount: currentUserDoc.accountNumber,
      receiverName:    currentUserDoc.displayName || `${currentUserDoc.firstName} ${currentUserDoc.lastName}`,
      involvedParties: [auth.currentUser.uid],
      reference:       txRef,
      timestamp:       serverTimestamp()
    });

    closeModal("depositModal");
  } catch (err) {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Credit Wallet";
    errorEl.textContent   = "Could not credit wallet. Try again.";
    errorEl.classList.add("show");
  }
});

// ══════════════════════════════════════════════════════════════
// EXCHANGE / CONVERT CRYPTO
// ══════════════════════════════════════════════════════════════
function updateExchangeModalBalances() {
  if (!currentUserDoc) return;
  const fromSel = document.getElementById("exchangeFrom").value;
  const toSel   = document.getElementById("exchangeTo").value;

  const balances = {
    USD:  currentUserDoc.walletBalance || 0,
    BTC:  currentUserDoc.btcBalance    || 0,
    ETH:  currentUserDoc.ethBalance    || 0,
    USDT: currentUserDoc.usdtBalance   || 0
  };

  const fmt = {
    USD:  v => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    BTC:  v => `${v.toFixed(6)} BTC`,
    ETH:  v => `${v.toFixed(5)} ETH`,
    USDT: v => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDT`
  };

  document.getElementById("exchangeFromBalance").textContent = fmt[fromSel]?.(balances[fromSel]) ?? "—";
  document.getElementById("exchangeToBalance").textContent   = fmt[toSel]?.(balances[toSel])     ?? "—";

  const unitRate  = (1 / exchangeRates[fromSel]) * exchangeRates[toSel];
  const precision = (toSel === "USD" || toSel === "USDT") ? 2 : 6;
  document.getElementById("exchangeLiveRate").textContent = `1 ${fromSel} = ${unitRate.toFixed(precision)} ${toSel}`;

  const inputAmt = parseFloat(document.getElementById("exchangeAmount").value) || 0;
  const estOut   = inputAmt * unitRate;
  document.getElementById("exchangeEstReceive").textContent = `${estOut.toFixed(precision)} ${toSel}`;
}

["exchangeFrom", "exchangeTo", "exchangeAmount"].forEach(id => {
  document.getElementById(id).addEventListener("input",  updateExchangeModalBalances);
  document.getElementById(id).addEventListener("change", updateExchangeModalBalances);
});

document.getElementById("exchangeForm").addEventListener("submit", async e => {
  e.preventDefault();
  const errorEl   = document.getElementById("exchangeError");
  const submitBtn = document.getElementById("exchangeSubmitBtn");
  errorEl.classList.remove("show");

  const fromSel  = document.getElementById("exchangeFrom").value;
  const toSel    = document.getElementById("exchangeTo").value;
  const inputAmt = parseFloat(document.getElementById("exchangeAmount").value);

  if (fromSel === toSel) {
    errorEl.textContent = "From and To currencies must be different.";
    errorEl.classList.add("show");
    return;
  }
  if (isNaN(inputAmt) || inputAmt <= 0) {
    errorEl.textContent = "Please enter a valid amount.";
    errorEl.classList.add("show");
    return;
  }

  const balances = {
    USD:  currentUserDoc.walletBalance || 0,
    BTC:  currentUserDoc.btcBalance    || 0,
    ETH:  currentUserDoc.ethBalance    || 0,
    USDT: currentUserDoc.usdtBalance   || 0
  };

  if (inputAmt > balances[fromSel]) {
    errorEl.textContent = `Insufficient ${fromSel} balance. Available: ${balances[fromSel].toFixed(6)}`;
    errorEl.classList.add("show");
    return;
  }

  submitBtn.disabled    = true;
  submitBtn.textContent = "Processing…";

  try {
    const unitRate   = (1 / exchangeRates[fromSel]) * exchangeRates[toSel];
    const receiveAmt = inputAmt * unitRate;

    const fieldMap = { USD: "walletBalance", BTC: "btcBalance", ETH: "ethBalance", USDT: "usdtBalance" };
    const updateObj = {};
    updateObj[fieldMap[fromSel]] = balances[fromSel] - inputAmt;
    updateObj[fieldMap[toSel]]   = (balances[toSel] || 0) + receiveAmt;

    await updateDoc(doc(db, "users", auth.currentUser.uid), updateObj);

    const amountUSD = fromSel === "USD" ? inputAmt : inputAmt / exchangeRates[fromSel];
    const precision = (toSel === "USD" || toSel === "USDT") ? 2 : 6;
    const txRef     = `RP-EX-${Math.floor(100000 + Math.random() * 900000)}`;

    await addDoc(collection(db, "transactions"), {
      type:            "conversion",
      amount:          amountUSD,
      description:     `Converted ${inputAmt} ${fromSel} → ${receiveAmt.toFixed(precision)} ${toSel}`,
      senderUid:       auth.currentUser.uid,
      senderAccount:   currentUserDoc.accountNumber,
      senderName:      currentUserDoc.displayName || `${currentUserDoc.firstName} ${currentUserDoc.lastName}`,
      receiverUid:     auth.currentUser.uid,
      receiverAccount: currentUserDoc.accountNumber,
      receiverName:    currentUserDoc.displayName || `${currentUserDoc.firstName} ${currentUserDoc.lastName}`,
      involvedParties: [auth.currentUser.uid],
      reference:       txRef,
      timestamp:       serverTimestamp()
    });

    closeModal("exchangeModal");
  } catch (err) {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Confirm Exchange";
    errorEl.textContent   = "Conversion failed. Please try again.";
    errorEl.classList.add("show");
  }
});

// ══════════════════════════════════════════════════════════════
// GRANT APPLICATION
// ══════════════════════════════════════════════════════════════
const grantFormEl = document.getElementById("grantForm");
if (grantFormEl) grantFormEl.addEventListener("submit", e => {
  e.preventDefault();
  const errorEl    = document.getElementById("grantError");
  const category   = document.getElementById("grantCategory").value;
  const employment = document.getElementById("grantEmployment").value;
  const income     = parseFloat(document.getElementById("grantIncome").value);
  const amount     = parseFloat(document.getElementById("grantAmount").value);
  const purpose    = document.getElementById("grantPurpose").value.trim();

  errorEl.classList.remove("show");

  if (!category || !employment || isNaN(income) || isNaN(amount) || !purpose) {
    errorEl.textContent = "Please fill in all required fields.";
    errorEl.classList.add("show");
    return;
  }
  if (amount <= 0 || amount > 50000) {
    errorEl.textContent = "Amount must be between $1 and $50,000.";
    errorEl.classList.add("show");
    return;
  }

  document.getElementById("grantFormSection").style.display       = "none";
  document.getElementById("grantProcessingSection").style.display  = "flex";

  runGrantProcessing(amount, purpose, category, employment, income);
});

function runGrantProcessing(amount, purpose, category, employment, income) {
  const steps     = ["step1", "step2", "step3", "step4"];
  const durations = [1000, 1300, 1100, 900];
  let idx = 0;

  steps.forEach(id => {
    const el = document.getElementById(id);
    el.className = "eval-step";
    el.querySelector("i").className = "bi bi-circle";
  });

  function next() {
    if (idx >= steps.length) {
      submitGrantApplication(amount, purpose, category, employment, income);
      return;
    }
    const el = document.getElementById(steps[idx]);
    el.className = "eval-step active";
    setTimeout(() => {
      el.className = "eval-step done";
      el.querySelector("i").className = "bi bi-check-circle-fill";
      idx++;
      next();
    }, durations[idx]);
  }
  next();
}

async function submitGrantApplication(amount, purpose, category, employment, income) {
  try {
    const user     = auth.currentUser;
    const fullName = currentUserDoc.displayName ||
      `${currentUserDoc.firstName || ""} ${currentUserDoc.lastName || ""}`.trim();

    await addDoc(collection(db, "applications"), {
      applicantUid:   user.uid,
      applicantName:  fullName,
      applicantEmail: user.email,
      accountNumber:  currentUserDoc.accountNumber,
      amount,
      purpose,
      category,
      employment,
      monthlyIncome:  income,
      status:         "pending",
      createdAt:      serverTimestamp()
    });

    const procSecEl = document.getElementById("grantProcessingSection");
    if (procSecEl) procSecEl.style.display = "none";
    const approvedAmtEl = document.getElementById("grantApprovedAmount");
    if (approvedAmtEl) approvedAmtEl.textContent =
      `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    const succSecEl = document.getElementById("grantSuccessSection");
    if (succSecEl) succSecEl.style.display = "flex";
  } catch (err) {
    console.error("Grant submission error:", err);
    closeModal("grantModal");
    alert("Submission failed. Please check your connection and try again.");
  }
}

document.getElementById("closeGrantSuccessBtn")?.addEventListener("click", () => {
  closeModal("grantModal");
});

// ══════════════════════════════════════════════════════════════
// EDIT PROFILE
// ══════════════════════════════════════════════════════════════
document.getElementById("profileForm").addEventListener("submit", async e => {
  e.preventDefault();
  const errorEl   = document.getElementById("profileError");
  const submitBtn = document.getElementById("profileSubmitBtn");
  const firstName = document.getElementById("profileFirstName").value.trim();
  const lastName  = document.getElementById("profileLastName").value.trim();
  const phone     = document.getElementById("profilePhone").value.trim();
  const bio       = document.getElementById("profileBio").value.trim();

  errorEl.classList.remove("show");
  if (!firstName || !lastName) {
    errorEl.textContent = "First and last name are required.";
    errorEl.classList.add("show");
    return;
  }

  submitBtn.disabled    = true;
  submitBtn.textContent = "Saving…";

  try {
    await updateDoc(doc(db, "users", auth.currentUser.uid), {
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      phone,
      bio
    });
    closeModal("profileModal");
  } catch (err) {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Save Changes";
    errorEl.textContent   = "Could not save profile. Please try again.";
    errorEl.classList.add("show");
  }
});
