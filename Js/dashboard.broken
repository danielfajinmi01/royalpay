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
  collection, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Firebase Config ───────────────────────────────────────────────────────────
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

// ─── App State ─────────────────────────────────────────────────────────────────
let currentUserDoc = null;
let activeFilter = "all";
let rawTransactions = [];
let selectedCurrency = "USD";

// Exchange rates: 1 USD = X of currency. 
// Crypto is initialized to fallbacks and updated dynamically via CoinGecko.
const exchangeRates = {
  USD: 1,
  NGN: 1500,        // 1 USD = 1500 NGN
  BTC: 0.0000146,   // 1 USD = ~0.0000146 BTC ($68,500 BTC)
  ETH: 0.000267,    // 1 USD = ~0.000267 ETH ($3,750 ETH)
  USDT: 1           // 1 USD = 1 USDT
};

// ─── Auth Guard ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "./login.html";
  } else {
    initializeDashboard(user);
  }
});

// ─── Initialize Dashboard ──────────────────────────────────────────────────────
function initializeDashboard(user) {
  // 1. Live Exchange Rates Update
  fetchRates();
  setInterval(fetchRates, 60000); // refresh rates every minute

  // 2. Real-time User Doc Listener
  const userRef = doc(db, "users", user.uid);
  onSnapshot(userRef, (snapshot) => {
    if (snapshot.exists()) {
      currentUserDoc = snapshot.data();
      
      // Ensure crypto wallets exist in the document (backwards compatibility)
      if (currentUserDoc.btcBalance === undefined || 
          currentUserDoc.ethBalance === undefined || 
          currentUserDoc.usdtBalance === undefined) {
        updateDoc(userRef, {
          btcBalance: currentUserDoc.btcBalance || 0,
          ethBalance: currentUserDoc.ethBalance || 0,
          usdtBalance: currentUserDoc.usdtBalance || 0
        });
      }

      updateUserUI(currentUserDoc);
      autofillForms(currentUserDoc);
    }
  });

  // 3. Real-time Transactions Listener
  const txQuery = query(
    collection(db, "transactions"),
    where("involvedParties", "array-contains", user.uid)
  );

  onSnapshot(txQuery, (snapshot) => {
    rawTransactions = [];
    snapshot.forEach((doc) => {
      rawTransactions.push({ id: doc.id, ...doc.data() });
    });
    
    // Sort transactions by timestamp (descending) in JavaScript to avoid Firestore index errors
    rawTransactions.sort((a, b) => {
      const timeA = a.timestamp?.seconds || 0;
      const timeB = b.timestamp?.seconds || 0;
      return timeB - timeA;
    });

    renderTransactions(rawTransactions);
    renderActivityLog(rawTransactions);
  });
}

// ─── Fetch Crypto Rates (CoinGecko) ───────────────────────────────────────────
async function fetchRates() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd,ngn");
    if (!res.ok) throw new Error("CoinGecko rate limit or network issue");
    const data = await res.json();
    
    const btcUSD = data.bitcoin.usd;
    const ethUSD = data.ethereum.usd;
    const usdtUSD = data.tether.usd;
    const ngnUSD = data.bitcoin.ngn / btcUSD; // Derive NGN/USD rate

    exchangeRates.BTC  = 1 / btcUSD;
    exchangeRates.ETH  = 1 / ethUSD;
    exchangeRates.USDT = 1 / usdtUSD;
    exchangeRates.NGN  = ngnUSD || 1500;

    // Update ticker UI
    document.getElementById("tickerBTC").textContent = `$${btcUSD.toLocaleString()}`;
    document.getElementById("tickerETH").textContent = `$${ethUSD.toLocaleString()}`;
    document.getElementById("tickerUSDT").textContent = `$${usdtUSD.toFixed(2)}`;
    
    // Refresh display balance if user doc loaded
    if (currentUserDoc) {
      updateUserUI(currentUserDoc);
    }
  } catch (err) {
    console.warn("Using fallback exchange rates:", err);
    document.getElementById("tickerBTC").textContent = "$68,500.00 (fallback)";
    document.getElementById("tickerETH").textContent = "$3,750.00 (fallback)";
    document.getElementById("tickerUSDT").textContent = "$1.00 (fallback)";
  }
}

// ─── Format Currency Display Helper ───────────────────────────────────────────
function formatValue(valueUSD, currency) {
  const rate = exchangeRates[currency];
  const converted = valueUSD * rate;

  if (currency === "USD") {
    return `$${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else if (currency === "NGN") {
    return `₦${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else if (currency === "BTC") {
    return `₿${converted.toFixed(6)}`;
  } else if (currency === "ETH") {
    return `Ξ${converted.toFixed(5)}`;
  } else if (currency === "USDT") {
    return `₮${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${valueUSD.toFixed(2)}`;
}

// ─── Update User UI ───────────────────────────────────────────────────────────
function updateUserUI(data) {
  // Name & profile picture
  const nameLabel = document.getElementById("userNameLabel");
  const avatarPlaceholder = document.getElementById("avatarPlaceholder");
  const userAvatar = document.getElementById("userAvatar");
  const fullName = data.displayName || data.firstName + " " + data.lastName || "Royal Pay User";

  nameLabel.textContent = fullName;
  
  if (data.photoURL) {
    userAvatar.src = data.photoURL;
    userAvatar.style.display = "block";
    avatarPlaceholder.style.display = "none";
  } else {
    avatarPlaceholder.textContent = fullName.charAt(0).toUpperCase();
    avatarPlaceholder.style.display = "grid";
    userAvatar.style.display = "none";
  }

  // Account Number & Profile metadata
  const accNumEl = document.getElementById("displayAccountNumber");
  if (data.accountNumber) {
    accNumEl.textContent = data.accountNumber;
    console.log("✓ Account number set:", data.accountNumber);
  } else {
    accNumEl.textContent = "PENDING";
    accNumEl.style.color = "orange";
    console.warn("⚠ No account number in user data:", data);
  }
  
  const emailEl = document.getElementById("metaEmail");
  if (data.email) {
    emailEl.textContent = data.email;
    console.log("✓ Email set:", data.email);
  } else {
    emailEl.textContent = "NOT SET";
    emailEl.style.color = "red";
    console.warn("⚠ No email in user data:", data);
  }
  
  if (data.createdAt) {
    const joinedDate = new Date(data.createdAt.seconds * 1000);
    document.getElementById("metaJoined").textContent = joinedDate.toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  } else {
    document.getElementById("metaJoined").textContent = "Instant Setup";
  }

  // Individual Wallet Balances
  const usdBal = data.usdBalance || data.walletBalance || 0;
  const btcBal = data.btcBalance || 0;
  const ethBal = data.ethBalance || 0;
  const usdtBal = data.usdtBalance || 0;

  document.getElementById("usdWalletVal").textContent = `$${usdBal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("btcWalletVal").textContent = `${btcBal.toFixed(5)} BTC`;
  document.getElementById("ethWalletVal").textContent = `${ethBal.toFixed(4)} ETH`;
  document.getElementById("usdtWalletVal").textContent = `$${usdtBal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;

  // Compute Total Assets Value (combined in selected display currency)
  const usdValue = usdBal;
  const btcUSDValue = btcBal / exchangeRates.BTC;
  const ethUSDValue = ethBal / exchangeRates.ETH;
  const usdtUSDValue = usdtBal / exchangeRates.USDT;
  
  const totalAssetsUSD = usdValue + btcUSDValue + ethUSDValue + usdtUSDValue;
  document.getElementById("totalBalanceUSD").textContent = formatValue(totalAssetsUSD, selectedCurrency);
}

// ─── Autofill forms with User doc details ─────────────────────────────────────
function autofillForms(data) {
  // Pre-fill Grant Application
  const nameInput = document.getElementById("grantName");
  const accInput = document.getElementById("grantAccountNumber");
  if (nameInput) nameInput.value = data.displayName || `${data.firstName} ${data.lastName}`;
  if (accInput) accInput.value = data.accountNumber;

  // Pre-fill Profile Edit
  const pFirst = document.getElementById("profileFirstName");
  const pLast = document.getElementById("profileLastName");
  const pPhone = document.getElementById("profilePhone");
  const pBio = document.getElementById("profileBio");

  if (pFirst && !pFirst.value) pFirst.value = data.firstName || data.displayName?.split(" ")[0] || "";
  if (pLast && !pLast.value) pLast.value = data.lastName || data.displayName?.split(" ").slice(1).join(" ") || "";
  if (pPhone && !pPhone.value) pPhone.value = data.phone || "";
  if (pBio && !pBio.value) pBio.value = data.bio || "";
}

// ─── Render Transaction Ledger ────────────────────────────────────────────────
function renderTransactions(txs) {
  const tableBody = document.getElementById("txTableBody");
  tableBody.innerHTML = "";

  const search = document.getElementById("txSearchInput").value.trim().toLowerCase();
  
  // Filter and search
  const filteredTxs = txs.filter(tx => {
    // 1. Filter Tab check
    if (activeFilter !== "all" && tx.type !== activeFilter) return false;
    
    // 2. Search check
    if (search) {
      const refMatch = tx.reference?.toLowerCase().includes(search);
      const descMatch = tx.description?.toLowerCase().includes(search);
      const senderMatch = tx.senderAccount?.includes(search);
      const recMatch = tx.receiverAccount?.includes(search);
      return refMatch || descMatch || senderMatch || recMatch;
    }
    return true;
  });

  if (filteredTxs.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" class="table-empty">No transaction history found matching current filters.</td></tr>`;
    return;
  }

  filteredTxs.forEach((tx) => {
    const isIncoming = tx.receiverUid === auth.currentUser.uid;
    const isGrant = tx.type === "grant";
    const isDeposit = tx.type === "deposit";
    const isConvert = tx.type === "conversion";

    let txClass = "minus";
    let iconClass = "bi-arrow-up-right";
    let statusClass = "sent";
    let amtPrefix = "-";

    if (isIncoming || isGrant || isDeposit) {
      txClass = "plus";
      iconClass = isGrant ? "bi-award-fill" : isDeposit ? "bi-wallet2" : "bi-arrow-down-left";
      statusClass = isGrant ? "grant" : isDeposit ? "received" : "received";
      amtPrefix = "+";
    } else if (isConvert) {
      txClass = "plus";
      iconClass = "bi-arrow-left-right";
      statusClass = "convert";
      amtPrefix = "⇌";
    }

    const txDate = tx.timestamp ? new Date(tx.timestamp.seconds * 1000) : new Date();
    const formattedDate = txDate.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const amountDisplay = `${amtPrefix}$${(tx.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <span class="tx-type-cell">
          <span class="tx-icon-ind ${statusClass}"><i class="bi ${iconClass}"></i></span>
          ${tx.type.toUpperCase()}
        </span>
      </td>
      <td><span class="tx-ref-cell">${tx.reference || "N/A"}</span></td>
      <td><span class="tx-date-cell">${formattedDate}</span></td>
      <td><span class="tx-desc-cell">${tx.description || "Simulated Ledger Entry"}</span></td>
      <td class="text-right"><span class="tx-amt-cell ${txClass}">${amountDisplay}</span></td>
    `;
    tableBody.appendChild(row);
  });
}

// ─── Render Activity Log Widget ───────────────────────────────────────────────
function renderActivityLog(txs) {
  const notifContainer = document.getElementById("notifList");
  notifContainer.innerHTML = "";

  const limitTxs = txs.slice(0, 4); // show top 4 recent actions
  
  if (limitTxs.length === 0) {
    notifContainer.innerHTML = `<div class="notif-placeholder">No recent activity. Initiate transactions to populate.</div>`;
    return;
  }

  limitTxs.forEach(tx => {
    const isIncoming = tx.receiverUid === auth.currentUser.uid;
    const isGrant = tx.type === "grant";
    const isDeposit = tx.type === "deposit";
    
    let typeClass = "warning";
    let logMsg = tx.description;

    if (isIncoming) {
      typeClass = "success";
      logMsg = `Received $${tx.amount.toLocaleString()} from account ending in ...${tx.senderAccount.slice(-4)}`;
    } else if (tx.type === "transfer") {
      typeClass = "warning";
      logMsg = `Transferred $${tx.amount.toLocaleString()} to account ending in ...${tx.receiverAccount.slice(-4)}`;
    } else if (isGrant) {
      typeClass = "success";
      logMsg = `Grant funding approved: $${tx.amount.toLocaleString()}`;
    } else if (isDeposit) {
      typeClass = "success";
      logMsg = `Added demo funds of $${tx.amount.toLocaleString()}`;
    }

    const item = document.createElement("div");
    item.className = `notif-item ${typeClass}`;
    
    const txTime = tx.timestamp ? new Date(tx.timestamp.seconds * 1000) : new Date();
    const timeString = txTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    item.innerHTML = `
      <span>${logMsg}</span>
      <span class="notif-time">${timeString}</span>
    `;
    notifContainer.appendChild(item);
  });
}

// ─── Dropdown Toggles ──────────────────────────────────────────────────────────
const dropdown = document.getElementById("userDropdown");
document.getElementById("userMenuTrigger").addEventListener("click", (e) => {
  e.stopPropagation();
  dropdown.classList.toggle("show");
  document.getElementById("userMenuTrigger").querySelector("i").style.transform = dropdown.classList.contains("show") ? "rotate(180deg)" : "rotate(0)";
});

document.addEventListener("click", () => {
  dropdown.classList.remove("show");
  document.getElementById("userMenuTrigger").querySelector("i").style.transform = "rotate(0)";
});

// ─── Switch Display Currency ──────────────────────────────────────────────────
document.getElementById("displayCurrency").addEventListener("change", (e) => {
  selectedCurrency = e.target.value;
  if (currentUserDoc) updateUserUI(currentUserDoc);
});

// ─── Modals Management Helpers ────────────────────────────────────────────────
function openModal(modalId) {
  document.getElementById(modalId).classList.add("show");
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove("show");
  // Reset forms and error displays
  const form = document.getElementById(modalId).querySelector("form");
  if (form) form.reset();
  const errorEl = document.getElementById(modalId).querySelector(".modal-error-banner");
  if (errorEl) errorEl.classList.remove("show");
}

document.querySelectorAll("[data-modal-close]").forEach(btn => {
  btn.addEventListener("click", (e) => {
    const modal = e.target.closest(".modal-overlay");
    closeModal(modal.id);
  });
});

// Open button triggers
document.getElementById("openTransferModal").addEventListener("click", () => {
  document.getElementById("transferReceiverName").textContent = "";
  openModal("transferModal");
});
document.getElementById("openDepositModal").addEventListener("click", () => openModal("depositModal"));
document.getElementById("openExchangeModal").addEventListener("click", () => {
  updateExchangeModalBalances();
  openModal("exchangeModal");
});
document.getElementById("openGrantModal").addEventListener("click", () => {
  // Reset grant views
  document.getElementById("grantFormSection").style.display = "block";
  document.getElementById("grantProcessingSection").style.display = "none";
  document.getElementById("grantSuccessSection").style.display = "none";
  openModal("grantModal");
});
document.getElementById("editProfileBtn").addEventListener("click", () => openModal("profileModal"));

// ─── Copy Account Number Action ───────────────────────────────────────────────
document.getElementById("copyAccBtn").addEventListener("click", () => {
  const accNum = document.getElementById("displayAccountNumber").textContent;
  navigator.clipboard.writeText(accNum).then(() => {
    const copyBtn = document.getElementById("copyAccBtn");
    copyBtn.innerHTML = `<i class="bi bi-check-lg" style="color: white;"></i>`;
    copyBtn.style.backgroundColor = "var(--mint)";
    
    setTimeout(() => {
      copyBtn.innerHTML = `<i class="bi bi-copy"></i>`;
      copyBtn.style.backgroundColor = "";
    }, 2000);
  });
});

// ─── Logout Action ────────────────────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "./login.html";
  } catch (err) {
    console.error("Logout failed:", err);
  }
});

// ─── Transfer Recipient Lookup / Validation ──────────────────────────────────
let lookupTimeout = null;
document.getElementById("transferReceiver").addEventListener("input", (e) => {
  const val = e.target.value.trim();
  const nameLabel = document.getElementById("transferReceiverName");
  const submitBtn = document.getElementById("transferSubmitBtn");
  
  nameLabel.textContent = "";
  nameLabel.classList.remove("error");
  submitBtn.disabled = true;

  if (val.length < 10) return;

  // Debounce API lookup
  clearTimeout(lookupTimeout);
  document.getElementById("transferVerificationSpinner").style.display = "block";
  
  lookupTimeout = setTimeout(async () => {
    try {
      const qUsers = query(collection(db, "users"), where("accountNumber", "==", val));
      const snap = await getDoc(doc(db, "users", "checking")); // dummy check
      
      // Fetch users
      const querySnap = await getDoc(doc(db, "users", "dummy")); // placeholder, let's query the collection instead:
      
      // Correct query collection fetching
      let receiverDoc = null;
      // We will perform the lookup on snapshot or simple collection reference fetching
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("accountNumber", "==", val));
      
      // Standard query snap
      const { getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const querySnapshot = await getDocs(q);
      
      document.getElementById("transferVerificationSpinner").style.display = "none";

      if (!querySnapshot.empty) {
        receiverDoc = querySnapshot.docs[0].data();
        if (receiverDoc.uid === auth.currentUser.uid) {
          nameLabel.textContent = "✕ You cannot transfer to yourself.";
          nameLabel.classList.add("error");
        } else {
          nameLabel.textContent = `✓ Recipient: ${receiverDoc.displayName || receiverDoc.firstName + " " + receiverDoc.lastName}`;
          nameLabel.classList.remove("error");
          submitBtn.disabled = false;
        }
      } else {
        nameLabel.textContent = "✕ Account number not found.";
        nameLabel.classList.add("error");
      }
    } catch (err) {
      document.getElementById("transferVerificationSpinner").style.display = "none";
      console.error(err);
      nameLabel.textContent = "✕ Error verifying recipient.";
      nameLabel.classList.add("error");
    }
  }, 400);
});

// ─── Transfer Submit Action ──────────────────────────────────────────────────
document.getElementById("transferForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("transferError");
  const submitBtn = document.getElementById("transferSubmitBtn");
  errorEl.classList.remove("show");

  const receiverAcc = document.getElementById("transferReceiver").value.trim();
  const amtStr = document.getElementById("transferAmount").value;
  const note = document.getElementById("transferNote").value.trim();
  const amount = parseFloat(amtStr);

  if (!receiverAcc || isNaN(amount) || amount <= 0) {
    errorEl.textContent = "Please specify a valid receiver and amount.";
    errorEl.classList.add("show");
    return;
  }

  if (amount > (currentUserDoc.walletBalance || 0)) {
    errorEl.textContent = "Insufficient USD Wallet balance for this transfer.";
    errorEl.classList.add("show");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Processing transfer...";

  try {
    const { getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const q = query(collection(db, "users"), where("accountNumber", "==", receiverAcc));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error("Recipient account no longer active.");
    }

    const receiverDocSnap = querySnapshot.docs[0];
    const receiverData = receiverDocSnap.data();

    // Deduct from Sender
    const senderRef = doc(db, "users", auth.currentUser.uid);
    await updateDoc(senderRef, {
      walletBalance: (currentUserDoc.walletBalance || 0) - amount
    });

    // Credit Receiver
    const receiverRef = doc(db, "users", receiverData.uid);
    await updateDoc(receiverRef, {
      walletBalance: (receiverData.walletBalance || 0) + amount
    });

    // Create Transaction Record
    const txRef = `RP-TX-${Math.floor(100000 + Math.random() * 900000)}`;
    await addDoc(collection(db, "transactions"), {
      type: "transfer",
      amount: amount,
      description: note ? `Transfer: ${note}` : `Transfer to ${receiverData.displayName || receiverData.firstName}`,
      senderUid: auth.currentUser.uid,
      senderAccount: currentUserDoc.accountNumber,
      senderName: currentUserDoc.displayName || `${currentUserDoc.firstName} ${currentUserDoc.lastName}`,
      receiverUid: receiverData.uid,
      receiverAccount: receiverData.accountNumber,
      receiverName: receiverData.displayName || `${receiverData.firstName} ${receiverData.lastName}`,
      involvedParties: [auth.currentUser.uid, receiverData.uid],
      reference: txRef,
      timestamp: serverTimestamp()
    });

    closeModal("transferModal");
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Initiate Transfer";
    errorEl.textContent = err.message || "An error occurred during transfer.";
    errorEl.classList.add("show");
  }
});

// ─── Deposit Preset Amounts & Custom Submit ──────────────────────────────────
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

document.getElementById("depositForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("depositError");
  const submitBtn = document.getElementById("depositSubmitBtn");
  const amtStr = document.getElementById("customDepositAmount").value;
  const amount = parseFloat(amtStr);

  if (isNaN(amount) || amount <= 0) {
    errorEl.textContent = "Please specify a valid amount.";
    errorEl.classList.add("show");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Crediting Ledger...";

  try {
    const userRef = doc(db, "users", auth.currentUser.uid);
    await updateDoc(userRef, {
      walletBalance: (currentUserDoc.walletBalance || 0) + amount
    });

    const txRef = `RP-DEP-${Math.floor(100000 + Math.random() * 900000)}`;
    await addDoc(collection(db, "transactions"), {
      type: "deposit",
      amount: amount,
      description: "Demo Deposit Credit",
      senderUid: "SYSTEM",
      senderAccount: "0000000000",
      senderName: "Royal Pay Ledger System",
      receiverUid: auth.currentUser.uid,
      receiverAccount: currentUserDoc.accountNumber,
      receiverName: currentUserDoc.displayName || `${currentUserDoc.firstName} ${currentUserDoc.lastName}`,
      involvedParties: [auth.currentUser.uid],
      reference: txRef,
      timestamp: serverTimestamp()
    });

    closeModal("depositModal");
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Credit Wallet";
    errorEl.textContent = "Could not credit demo funds.";
    errorEl.classList.add("show");
  }
});

// ─── Convert Crypto Modal Balance & Conversions ────────────────────────────────
function updateExchangeModalBalances() {
  if (!currentUserDoc) return;
  const fromSel = document.getElementById("exchangeFrom").value;
  const toSel = document.getElementById("exchangeTo").value;

  const balances = {
    USD: currentUserDoc.walletBalance || 0,
    BTC: currentUserDoc.btcBalance || 0,
    ETH: currentUserDoc.ethBalance || 0,
    USDT: currentUserDoc.usdtBalance || 0
  };

  const formats = {
    USD: (v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    BTC: (v) => `${v.toFixed(6)} BTC`,
    ETH: (v) => `${v.toFixed(5)} ETH`,
    USDT: (v) => `$${v.toLocaleString()} USDT`
  };

  document.getElementById("exchangeFromBalance").textContent = formats[fromSel](balances[fromSel]);
  document.getElementById("exchangeToBalance").textContent = formats[toSel](balances[toSel]);

  // Compute conversion rate From -> To
  // 1 From = Rate To
  // We have exchangeRates: 1 USD = X. So 1 From = (1/rateFrom) * rateTo
  const rateFrom = exchangeRates[fromSel];
  const rateTo = exchangeRates[toSel];
  const unitRate = (1 / rateFrom) * rateTo;

  document.getElementById("exchangeLiveRate").textContent = `1 ${fromSel} = ${unitRate.toFixed(toSel === "USD" || toSel === "USDT" ? 2 : 6)} ${toSel}`;
  
  // Calculate estimate
  const inputAmt = parseFloat(document.getElementById("exchangeAmount").value) || 0;
  const estOut = inputAmt * unitRate;
  document.getElementById("exchangeEstReceive").textContent = `${estOut.toFixed(toSel === "USD" || toSel === "USDT" ? 2 : 6)} ${toSel}`;
}

// Bind selectors in Exchange modal
["exchangeFrom", "exchangeTo", "exchangeAmount"].forEach(id => {
  document.getElementById(id).addEventListener("input", updateExchangeModalBalances);
  document.getElementById(id).addEventListener("change", updateExchangeModalBalances);
});

document.getElementById("exchangeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("exchangeError");
  const submitBtn = document.getElementById("exchangeSubmitBtn");
  
  const fromSel = document.getElementById("exchangeFrom").value;
  const toSel = document.getElementById("exchangeTo").value;
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
    USD: currentUserDoc.walletBalance || 0,
    BTC: currentUserDoc.btcBalance || 0,
    ETH: currentUserDoc.ethBalance || 0,
    USDT: currentUserDoc.usdtBalance || 0
  };

  if (inputAmt > balances[fromSel]) {
    errorEl.textContent = `Insufficient ${fromSel} balance for this conversion.`;
    errorEl.classList.add("show");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Processing Conversion...";

  try {
    const rateFrom = exchangeRates[fromSel];
    const rateTo = exchangeRates[toSel];
    const unitRate = (1 / rateFrom) * rateTo;
    const receiveAmt = inputAmt * unitRate;

    // Database field map
    const fieldMap = {
      USD: "walletBalance",
      BTC: "btcBalance",
      ETH: "ethBalance",
      USDT: "usdtBalance"
    };

    const updateObj = {};
    updateObj[fieldMap[fromSel]] = balances[fromSel] - inputAmt;
    updateObj[fieldMap[toSel]] = balances[toSel] + receiveAmt;

    const userRef = doc(db, "users", auth.currentUser.uid);
    await updateDoc(userRef, updateObj);

    // Write transaction ledger (recorded in USD equivalent value)
    const amountUSD = fromSel === "USD" ? inputAmt : inputAmt / rateFrom;
    const txRef = `RP-EX-${Math.floor(100000 + Math.random() * 900000)}`;

    await addDoc(collection(db, "transactions"), {
      type: "conversion",
      amount: amountUSD,
      description: `Converted ${inputAmt} ${fromSel} to ${receiveAmt.toFixed(toSel === "USD" || toSel === "USDT" ? 2 : 5)} ${toSel}`,
      senderUid: auth.currentUser.uid,
      senderAccount: currentUserDoc.accountNumber,
      senderName: currentUserDoc.displayName || `${currentUserDoc.firstName} ${currentUserDoc.lastName}`,
      receiverUid: auth.currentUser.uid,
      receiverAccount: currentUserDoc.accountNumber,
      receiverName: currentUserDoc.displayName || `${currentUserDoc.firstName} ${currentUserDoc.lastName}`,
      involvedParties: [auth.currentUser.uid],
      reference: txRef,
      timestamp: serverTimestamp()
    });

    closeModal("exchangeModal");
  } catch (err) {
    console.error(err);
    submitBtn.disabled = false;
    submitBtn.textContent = "Confirm Exchange";
    errorEl.textContent = "Transaction failed. Try again.";
    errorEl.classList.add("show");
  }
});

// ─── Grant Application Form Submission ────────────────────────────────────────
document.getElementById("grantForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("grantError");
  const category = document.getElementById("grantCategory").value;
  const employment = document.getElementById("grantEmployment").value;
  const income = parseFloat(document.getElementById("grantIncome").value);
  const amount = parseFloat(document.getElementById("grantAmount").value);
  const purpose = document.getElementById("grantPurpose").value.trim();

  if (!category || !employment || isNaN(income) || isNaN(amount) || !purpose) {
    errorEl.textContent = "Please fill in all requested fields.";
    errorEl.classList.add("show");
    return;
  }

  if (amount > 50000) {
    errorEl.textContent = "Requested amount exceeds maximum grant limit of $50,000.";
    errorEl.classList.add("show");
    return;
  }

  // Switch to processing animation
  document.getElementById("grantFormSection").style.display = "none";
  document.getElementById("grantProcessingSection").style.display = "flex";
  
  // Run animated review stages, then submit to pending queue
  runGrantProcessingStages(amount, purpose, category, employment, income);
});

function runGrantProcessingStages(amount, purpose, category, employment, income) {
  const steps = [
    { id: "step1", duration: 1100 },
    { id: "step2", duration: 1400 },
    { id: "step3", duration: 1200 },
    { id: "step4", duration: 1000 }
  ];

  let currentIdx = 0;

  function runNextStep() {
    if (currentIdx >= steps.length) {
      // Complete stages → submit to pending queue
      submitGrantApplication(amount, purpose, category, employment, income);
      return;
    }

    const step = steps[currentIdx];
    const stepEl = document.getElementById(step.id);
    stepEl.className = "eval-step active";
    
    setTimeout(() => {
      stepEl.className = "eval-step done";
      stepEl.querySelector("i").className = "bi bi-check-circle-fill";
      currentIdx++;
      runNextStep();
    }, step.duration);
  }

  // Reset checkmark classes of steps
  document.querySelectorAll(".eval-step").forEach((el) => {
    el.className = "eval-step";
    el.querySelector("i").className = "bi bi-circle";
  });

  runNextStep();
}

// ─── Submit Grant Application to Pending Queue ────────────────────────────────
async function submitGrantApplication(amount, purpose, category, employment, income) {
  try {
    const user = auth.currentUser;
    const fullName = currentUserDoc.displayName ||
      `${currentUserDoc.firstName || ""} ${currentUserDoc.lastName || ""}`.trim();

    // Save to applications collection (pending admin review)
    await addDoc(collection(db, "applications"), {
      applicantUid:   user.uid,
      applicantName:  fullName,
      applicantEmail: user.email,
      accountNumber:  currentUserDoc.accountNumber,
      amount:         amount,
      purpose:        purpose,
      category:       category,
      employment:     employment,
      monthlyIncome:  income,
      status:         "pending",
      createdAt:      serverTimestamp()
    });

    // Show pending success screen
    document.getElementById("grantProcessingSection").style.display = "none";
    document.getElementById("grantApprovedAmount").textContent =
      `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    document.getElementById("grantSuccessSection").style.display = "flex";

  } catch (err) {
    console.error(err);
    closeModal("grantModal");
    alert("Submission failed. Please check your connection and try again.");
  }
}

document.getElementById("closeGrantSuccessBtn").addEventListener("click", () => {
  closeModal("grantModal");
});

// ─── Edit Profile Submission ──────────────────────────────────────────────────
document.getElementById("profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("profileError");
  const submitBtn = document.getElementById("profileSubmitBtn");
  
  const firstName = document.getElementById("profileFirstName").value.trim();
  const lastName = document.getElementById("profileLastName").value.trim();
  const phone = document.getElementById("profilePhone").value.trim();
  const bio = document.getElementById("profileBio").value.trim();

  if (!firstName || !lastName) {
    errorEl.textContent = "First Name and Last Name are required.";
    errorEl.classList.add("show");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Saving changes...";

  try {
    const userRef = doc(db, "users", auth.currentUser.uid);
    await updateDoc(userRef, {
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      phone,
      bio
    });
    closeModal("profileModal");
  } catch (err) {
    console.error(err);
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Changes";
    errorEl.textContent = "Could not update profile information.";
    errorEl.classList.add("show");
  }
});

// ─── Transaction Table Search & Filters ───────────────────────────────────────
document.getElementById("txSearchInput").addEventListener("input", () => {
  renderTransactions(rawTransactions);
});

document.querySelectorAll(".filter-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    activeFilter = tab.dataset.filter;
    renderTransactions(rawTransactions);
  });
});
