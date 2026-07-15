import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── If already logged in as admin, redirect immediately ──────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists() && snap.data().role === "admin") {
      window.location.href = "./admin-dashboard.html";
    } else {
      // Logged in as regular user — sign them out silently
      await signOut(auth);
    }
  }
});

// ── DOM ───────────────────────────────────────────────────────────────────────
const form      = document.getElementById("adminLoginForm");
const emailEl   = document.getElementById("adminEmail");
const passEl    = document.getElementById("adminPassword");
const errorEl   = document.getElementById("errorBanner");
const loginBtn  = document.getElementById("loginBtn");
const pwToggle  = document.getElementById("pwToggle");
const eyeIcon   = document.getElementById("eyeIcon");

// Password visibility toggle
pwToggle.addEventListener("click", () => {
  const isHidden = passEl.type === "password";
  passEl.type = isHidden ? "text" : "password";
  eyeIcon.className = isHidden ? "bi bi-eye-slash" : "bi bi-eye";
});

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add("show");
}

function clearError() {
  errorEl.classList.remove("show");
}

function setLoading(on) {
  loginBtn.disabled = on;
  loginBtn.classList.toggle("loading", on);
}

// ── Login Submit ──────────────────────────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const email    = emailEl.value.trim();
  const password = passEl.value;

  if (!email || !password) {
    showError("Please enter your email and password.");
    return;
  }

  setLoading(true);

  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);

    // Check or create admin document
    const userRef  = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      // First-time admin setup — seed admin profile
      await setDoc(userRef, {
        uid:          user.uid,
        email:        user.email,
        displayName:  "System Administrator",
        firstName:    "System",
        lastName:     "Administrator",
        role:         "admin",
        status:       "active",
        accountNumber:"0000000000",
        walletBalance: 0,
        usdBalance: 0,
        btcBalance: 0,
        ethBalance: 0,
        usdtBalance: 0,
        createdAt:    serverTimestamp(),
        lastLogin:    serverTimestamp()
      });
    } else {
      const data = userSnap.data();
      if (data.role !== "admin") {
        await signOut(auth);
        showError("Access denied. This account does not have administrator privileges.");
        setLoading(false);
        return;
      }
      // Update last login
      await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });
    }

    window.location.href = "./admin-dashboard.html";

  } catch (err) {
    setLoading(false);
    const map = {
      "auth/invalid-email":      "Please enter a valid email address.",
      "auth/user-not-found":     "No admin account found with this email.",
      "auth/wrong-password":     "Incorrect password. Please try again.",
      "auth/invalid-credential": "Invalid email or password.",
      "auth/too-many-requests":  "Too many attempts. Please try again later."
    };
    showError(map[err.code] || "Authentication failed. Please try again.");
  }
});
