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
  // Check banned status
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

  // Real-time user doc
  const userRef = doc(db, "users", user.uid);
  onSnapshot(userRef, (snapshot) => {
    if (!snapshot.exists()) return;
    currentUserDoc = snapshot.data();

    // Back-fill missing crypto fields (for older accounts)
    const missing = {};
    if (currentUserDoc.btcBalance  === undefined) missing.btcBalance  = 0;
    if (currentUserDoc.ethBalance  === undefined) missing.ethBalance  = 0;
    if (currentUserDoc.usdtBalance === undefined) missing.usdtBalance = 0;
    if (Object.keys(missing).length) updateDoc(userRef, missing);

    updateUserUI(currentUserDoc);
    autofillForms(currentUserDoc);
  });

  // Real-time transactions
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
    document.getElementById("tickerETH").textContent  = `$${ethUSD.toLocaleString()}`;
    document.getElementById("tickerUSDT").textContent = `$${usdtUSD.toFixed(4)}`;

    if (currentUserDoc) updateUserUI(currentUserDoc);
  } catch (_) {
    document.getElementById("tickerBTC").textContent  = "$68,500 (est.)";
    document.getElementById("tickerETH").textContent  = "$3,750 (est.)";
    document.getElementById("tickerUSDT").textContent = "$1.00";
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

  const avatarPlaceholder = document.getElementById("avatarPlaceholder");
  const userAvatar        = document.getElementById("userAvatar");
  if (data.photoURL) {
    userAvatar.src          = data.photoURL;
    userAvatar.style.display        = "block";
    avatarPlaceholder.style.display = "none";
  } else {
    avatarPlaceholder.textContent   = fullName.charAt(0).toUpperCase();
    avatarPlaceholder.style.display = "grid";
    userAvatar.style.display        = "none";
  }

  // Account details
  const accNum = data.accountNumber || "PENDING";
  document.getElementById("displayAccountNumber").textContent = accNum;
  document.getElementById("metaEmail").textContent = data.email || "Not set";
  if (data.createdAt) {
    const d = new Date(data.createdAt.seconds * 1000);
    document.getElementById("metaJoined").textContent =
      d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } else {
    document.getElementById("metaJoined").textContent = "Instant Setup";
  }

  // Wallet balances
  // USD wallet = walletBalance (used by deposit/transfer/grant)
  const usdBal  = data.walletBalance || 0;
  const btcBal  = data.btcBalance    || 0;
  const ethBal  = data.ethBalance    || 0;
  const usdtBal = data.usdtBalance   || 0;

  document.getElementById("usdWalletVal").textContent  =
    `$${usdBal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("btcWalletVal").textContent  = `${btcBal.toFixed(5)} BTC`;
  document.getElementById("ethWalletVal").textContent  = `${ethBal.toFixed(4)} ETH`;
  document.getElementById("usdtWalletVal").textContent =
    `$${usdtBal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;

  // Total assets in USD
  const totalUSD =
    usdBal +
    (btcBal  / exchangeRates.BTC) +
    (ethBal  / exchangeRates.ETH) +
    (usdtBal / exchangeRates.USDT);

  document.getElementById("totalBalanceUSD").textContent = formatValue(totalUSD, selectedCurrency);
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

// ─── Render Transaction Table ─────────────────────────────────────────────────
function renderTransactions(txs) {
  const tbody  = document.getElementById("txTableBody");
  const search = document.getElementById("txSearchInput").value.trim().toLowerCase();

  const filtered = txs.filter(tx => {
    if (activeFilter !== "all" && tx.type !== activeFilter) return false;
    if (search) {
      return (
        (tx.reference    || "").toLowerCase().includes(search) ||
        (tx.description  || "").toLowerCase().includes(search) ||
        (tx.senderAccount  || "").includes(search) ||
        (tx.receiverAccount || "").includes(search)
      );
    }
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No transactions match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(tx => {
    const isIncoming = tx.receiverUid === auth.currentUser?.uid;
    const isGrant    = tx.type === "grant";
    const isDeposit  = tx.type === "deposit";
    const isConvert  = tx.type === "conversion";

    let txClass     = "minus";
    let iconClass   = "bi-arrow-up-right";
    let statusClass = "sent";
    let amtPrefix   = "-";

    if (isIncoming || isGrant || isDeposit) {
      txClass     = "plus";
      iconClass   = isGrant ? "bi-award-fill" : isDeposit ? "bi-wallet2" : "bi-arrow-down-left";
      statusClass = isGrant ? "grant" : "received";
      amtPrefix   = "+";
    } else if (isConvert) {
      txClass     = "plus";
      iconClass   = "bi-arrow-left-right";
      statusClass = "convert";
      amtPrefix   = "⇌";
    }

    const ts   = tx.timestamp || tx.createdAt;
    const date = ts ? new Date(ts.seconds * 1000) : new Date();
    const fmt  = date.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
    const amount = `${amtPrefix}$${(tx.amount || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    })}`;

    return `<tr>
      <td><span class="tx-type-cell">
        <span class="tx-icon-ind ${statusClass}"><i class="bi ${iconClass}"></i></span>
        ${(tx.type || "tx").toUpperCase()}
      </span></td>
      <td><span class="tx-ref-cell">${tx.reference || "N/A"}</span></td>
      <td><span class="tx-date-cell">${fmt}</span></td>
      <td><span class="tx-desc-cell">${tx.description || "—"}</span></td>
      <td class="text-right"><span class="tx-amt-cell ${txClass}">${amount}</span></td>
    </tr>`;
  }).join("");
}

// ─── Render Activity Log ──────────────────────────────────────────────────────
function renderActivityLog(txs) {
  const container = document.getElementById("notifList");
  const recent    = txs.slice(0, 4);

  if (!recent.length) {
    container.innerHTML = `<div class="notif-placeholder">No recent activity yet.</div>`;
    return;
  }

  container.innerHTML = recent.map(tx => {
    const isIncoming = tx.receiverUid === auth.currentUser?.uid;
    let typeClass = "warning";
    let logMsg    = tx.description || "Transaction";

    if (isIncoming)             { typeClass = "success"; logMsg = `Received $${(tx.amount || 0).toLocaleString()} → Acc ...${(tx.senderAccount || "????").slice(-4)}`; }
    else if (tx.type === "transfer") { typeClass = "warning"; logMsg = `Sent $${(tx.amount || 0).toLocaleString()} → Acc ...${(tx.receiverAccount || "????").slice(-4)}`; }
    else if (tx.type === "grant")    { typeClass = "success"; logMsg = `Grant submitted: $${(tx.amount || 0).toLocaleString()}`; }
    else if (tx.type === "deposit")  { typeClass = "success"; logMsg = `Demo funds added: $${(tx.amount || 0).toLocaleString()}`; }
    else if (tx.type === "conversion") { typeClass = "success"; logMsg = tx.description || "Crypto conversion"; }

    const ts   = tx.timestamp || tx.createdAt;
    const time = ts ? new Date(ts.seconds * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";

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

// Close on overlay click
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ─── Open Modal Buttons ───────────────────────────────────────────────────────
document.getElementById("openTransferModal").addEventListener("click", () => {
  document.getElementById("transferReceiverName").textContent = "";
  document.getElementById("transferSubmitBtn").disabled = true;
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
  document.getElementById("grantFormSection").style.display     = "block";
  document.getElementById("grantProcessingSection").style.display = "none";
  document.getElementById("grantSuccessSection").style.display  = "none";
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
// TRANSFER MONEY
// ══════════════════════════════════════════════════════════════
let lookupTimeout = null;

document.getElementById("transferReceiver").addEventListener("input", e => {
  const val       = e.target.value.trim();
  const nameLabel = document.getElementById("transferReceiverName");
  const submitBtn = document.getElementById("transferSubmitBtn");
  const spinner   = document.getElementById("transferVerificationSpinner");

  nameLabel.textContent = "";
  nameLabel.classList.remove("error");
  submitBtn.disabled = true;

  if (val.length < 10) return;

  clearTimeout(lookupTimeout);
  spinner.style.display = "block";

  lookupTimeout = setTimeout(async () => {
    try {
      const q    = query(collection(db, "users"), where("accountNumber", "==", val));
      const snap = await getDocs(q);
      spinner.style.display = "none";

      if (!snap.empty) {
        const receiver = snap.docs[0].data();
        if (receiver.uid === auth.currentUser.uid) {
          nameLabel.textContent = "✕ Cannot transfer to your own account.";
          nameLabel.classList.add("error");
        } else {
          nameLabel.textContent = `✓ Recipient: ${receiver.displayName || (receiver.firstName + " " + receiver.lastName).trim()}`;
          nameLabel.classList.remove("error");
          submitBtn.disabled = false;
        }
      } else {
        nameLabel.textContent = "✕ Account number not found.";
        nameLabel.classList.add("error");
      }
    } catch (err) {
      spinner.style.display = "none";
      nameLabel.textContent = "✕ Error verifying recipient.";
      nameLabel.classList.add("error");
    }
  }, 500);
});

document.getElementById("transferForm").addEventListener("submit", async e => {
  e.preventDefault();
  const errorEl   = document.getElementById("transferError");
  const submitBtn = document.getElementById("transferSubmitBtn");
  errorEl.classList.remove("show");
  errorEl.textContent = "";

  const receiverAcc = document.getElementById("transferReceiver").value.trim();
  const amount      = parseFloat(document.getElementById("transferAmount").value);
  const note        = document.getElementById("transferNote").value.trim();

  if (!receiverAcc || isNaN(amount) || amount <= 0) {
    errorEl.textContent = "Please enter a valid recipient and amount.";
    errorEl.classList.add("show");
    return;
  }

  const senderBal = currentUserDoc?.walletBalance || 0;
  if (amount > senderBal) {
    errorEl.textContent = `Insufficient USD wallet balance. Available: $${senderBal.toLocaleString(undefined,{minimumFractionDigits:2})}`;
    errorEl.classList.add("show");
    return;
  }

  submitBtn.disabled    = true;
  submitBtn.textContent = "Processing...";

  try {
    const q    = query(collection(db, "users"), where("accountNumber", "==", receiverAcc));
    const snap = await getDocs(q);

    if (snap.empty) throw new Error("Recipient account not found.");

    const receiverData = snap.docs[0].data();

    // Deduct from sender
    await updateDoc(doc(db, "users", auth.currentUser.uid), {
      walletBalance: senderBal - amount
    });

    // Credit receiver
    await updateDoc(doc(db, "users", receiverData.uid), {
      walletBalance: (receiverData.walletBalance || 0) + amount
    });

    // Transaction record
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

    closeModal("transferModal");
  } catch (err) {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Send Money";
    errorEl.textContent   = err.message || "Transfer failed. Please try again.";
    errorEl.classList.add("show");
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
  submitBtn.textContent = "Crediting Wallet...";

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

  // 1 FROM in TO units
  const unitRate  = (1 / exchangeRates[fromSel]) * exchangeRates[toSel];
  const precision = (toSel === "USD" || toSel === "USDT") ? 2 : 6;
  document.getElementById("exchangeLiveRate").textContent = `1 ${fromSel} = ${unitRate.toFixed(precision)} ${toSel}`;

  // Live estimate
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
  submitBtn.textContent = "Processing...";

  try {
    const unitRate   = (1 / exchangeRates[fromSel]) * exchangeRates[toSel];
    const receiveAmt = inputAmt * unitRate;

    const fieldMap = { USD: "walletBalance", BTC: "btcBalance", ETH: "ethBalance", USDT: "usdtBalance" };
    const updateObj = {};
    updateObj[fieldMap[fromSel]] = balances[fromSel] - inputAmt;
    updateObj[fieldMap[toSel]]   = (balances[toSel]  || 0) + receiveAmt;

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
      receiverUid:     auth.currentUser.uid,
      receiverAccount: currentUserDoc.accountNumber,
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
document.getElementById("grantForm").addEventListener("submit", e => {
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

  // Switch to processing view
  document.getElementById("grantFormSection").style.display      = "none";
  document.getElementById("grantProcessingSection").style.display = "flex";

  runGrantProcessing(amount, purpose, category, employment, income);
});

function runGrantProcessing(amount, purpose, category, employment, income) {
  const steps     = ["step1", "step2", "step3", "step4"];
  const durations = [1000, 1300, 1100, 900];
  let idx = 0;

  // Reset all steps
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

    document.getElementById("grantProcessingSection").style.display = "none";
    document.getElementById("grantApprovedAmount").textContent =
      `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    document.getElementById("grantSuccessSection").style.display = "flex";
  } catch (err) {
    console.error("Grant submission error:", err);
    closeModal("grantModal");
    alert("Submission failed. Please check your connection and try again.");
  }
}

document.getElementById("closeGrantSuccessBtn").addEventListener("click", () => {
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
  submitBtn.textContent = "Saving...";

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
