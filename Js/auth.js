import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
const googleProvider = new GoogleAuthProvider();

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Redirect to loader then dashboard after a short branded delay.
 */
async function redirectToDashboard(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists() && snap.data().role === "admin") {
    window.location.href = "./admin-dashboard.html";
  } else {
    window.location.href = "./dashboard.html";
  }
}

/**
 * Show an inline error message beneath the form.
 * @param {string} message
 */
function showError(message) {
  let errorEl = document.querySelector(".auth-error");
  if (!errorEl) {
    errorEl = document.createElement("p");
    errorEl.className = "auth-error";
    const form = document.querySelector(".login-form");
    form.prepend(errorEl);
  }
  errorEl.textContent = message;
  errorEl.classList.add("visible");

  // Auto-dismiss after 5 s
  clearTimeout(errorEl._timer);
  errorEl._timer = setTimeout(() => errorEl.classList.remove("visible"), 5000);
}

function clearError() {
  const errorEl = document.querySelector(".auth-error");
  if (errorEl) errorEl.classList.remove("visible");
}

/**
 * Map Firebase auth error codes to friendly messages.
 * @param {string} code
 * @returns {string}
 */
function friendlyError(code) {
  const map = {
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/invalid-credential": "Invalid email or password. Please try again.",
    "auth/too-many-requests": "Too many failed attempts. Please try again later.",
    "auth/network-request-failed": "Network error. Please check your connection.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/cancelled-popup-request": "Only one sign-in popup allowed at a time.",
    "auth/popup-blocked": "Popup was blocked by your browser. Please allow popups."
  };
  return map[code] || "Something went wrong. Please try again.";
}

/**
 * Set button to loading state.
 * @param {HTMLButtonElement} btn
 * @param {string} label
 */
function setLoading(btn, label) {
  btn.disabled = true;
  btn.dataset.original = btn.textContent;
  btn.textContent = label;
  btn.classList.add("is-loading");
}

function clearLoading(btn) {
  btn.disabled = false;
  btn.textContent = btn.dataset.original || "Login";
  btn.classList.remove("is-loading");
}

/**
 * Ensure a Firestore user document exists for the given Firebase user.
 * Called after every successful sign-in so new Google users get a record.
 * @param {import("firebase/auth").User} user
 */
async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // Generate a unique 10-digit account number
    let accountNumber;
    let exists = true;
    while (exists) {
      accountNumber = String(Math.floor(1000000000 + Math.random() * 9000000000));
      // (In production you'd query Firestore to confirm uniqueness)
      exists = false;
    }

    await setDoc(ref, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || "",
      firstName: user.displayName ? user.displayName.split(" ")[0] : "User",
      lastName: user.displayName ? user.displayName.split(" ").slice(1).join(" ") : "",
      photoURL: user.photoURL || "",
      accountNumber,
      walletBalance: 0,
      usdBalance: 0,
      btcBalance: 0,
      ethBalance: 0,
      usdtBalance: 0,
      currency: "USD",
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
      role: "user",
      status: "active"
    });
  } else {
    // Update last login timestamp
    await setDoc(ref, { lastLogin: serverTimestamp() }, { merge: true });
  }
}

// ─── Auth State Guard ──────────────────────────────────────────────────────────
// If user is already logged in when they hit the login page, send them to the dashboard.
onAuthStateChanged(auth, (user) => {
  if (user) {
    redirectToDashboard(user);
  }
});

// ─── DOM Ready ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // ── DOM Elements ─────────────────────────────────────────────────────────────
  const form = document.querySelector(".auth-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const loginBtn = document.querySelector(".btn-auth-primary");
  const rememberCheck = document.querySelector("#terms"); // Checkbox is used for terms in signup, but let's grab it by terms ID or gracefully degrade
  const passwordToggle = document.querySelector("[data-password-toggle]");
  const googleBtn = document.querySelector("#googleBtn");
  const forgotLink = document.querySelector(".forgot-link");

  // ── Check if redirected due to suspension ───────────────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("error") === "banned") {
    showError("Your account has been suspended by the administrator.");
  }

  // ── Password visibility toggle ──────────────────────────────────────────────
  passwordToggle?.addEventListener("click", () => {
    const hidden = passwordInput.type === "password";
    passwordInput.type = hidden ? "text" : "password";
    passwordToggle.innerHTML = hidden
      ? '<i class="bi bi-eye-slash"></i>'
      : '<i class="bi bi-eye"></i>';
    passwordToggle.setAttribute("aria-label", hidden ? "Hide password" : "Show password");
  });

  // ── Clear error on typing ────────────────────────────────────────────────────
  [emailInput, passwordInput].forEach((el) => el?.addEventListener("input", clearError));

  // ── Email / Password Login & Signup ──────────────────────────────────────────
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const fullNameInput = document.getElementById("fullName");
    const isSignup = !!fullNameInput;

    if (!email || !password || (isSignup && !fullNameInput.value.trim())) {
      showError("Please fill in all required fields.");
      return;
    }

    setLoading(loginBtn, isSignup ? "Creating Account…" : "Signing in…");

    try {
      // Honour "remember me" checkbox
      const persistence = rememberCheck?.checked
        ? browserLocalPersistence
        : browserSessionPersistence;
      await setPersistence(auth, persistence);

      let user;
      if (isSignup) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        user = userCredential.user;
        // Optionally save full name to user doc
        await setDoc(doc(db, "users", user.uid), {
          name: fullNameInput.value.trim(),
          email: user.email,
          createdAt: serverTimestamp(),
          role: "user"
        });
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        user = userCredential.user;
      }

      // Check if user is banned
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists() && userSnap.data().status === "banned") {
        await signOut(auth);
        showError("Your account has been suspended by the administrator.");
        clearLoading(loginBtn);
        return;
      }

      await ensureUserDoc(user);
      redirectToDashboard(user);
    } catch (err) {
      clearLoading(loginBtn);
      showError(friendlyError(err.code));
    }
  });

  // ── Google Sign-In ───────────────────────────────────────────────────────────
  googleBtn?.addEventListener("click", async () => {
    clearError();
    setLoading(googleBtn, "Opening Google…");

    try {
      googleProvider.setCustomParameters({ prompt: "select_account" });
      const { user } = await signInWithPopup(auth, googleProvider);

      // Check if user is banned
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists() && userSnap.data().status === "banned") {
        await signOut(auth);
        showError("Your account has been suspended by the administrator.");
        clearLoading(googleBtn);
        return;
      }

      await ensureUserDoc(user);
      redirectToDashboard(user);
    } catch (err) {
      clearLoading(googleBtn);
      if (err.code !== "auth/popup-closed-by-user") {
        showError(friendlyError(err.code));
      }
    }
  });

  // ── Forgot Password ──────────────────────────────────────────────────────────
  forgotLink?.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) {
      showError("Enter your email address above, then click 'Forgot password?'.");
      emailInput.focus();
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      showError(`✓ Reset email sent to ${email}. Check your inbox.`);
      document.querySelector(".auth-error").style.color = "var(--mint)";
    } catch (err) {
      showError(friendlyError(err.code));
    }
  });
});
