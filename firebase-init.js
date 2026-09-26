// ─────────────────────────────────────────────────────────────
// 1. Paste your Firebase project config here (Firebase console →
//    Project settings → General → Your apps → SDK setup and config).
// ─────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAD07z0xz0ePwcaIbrkwE5VTkYbvVZ7zuI",
  authDomain: "cas-silent-auction.firebaseapp.com",
  projectId: "cas-silent-auction",
  storageBucket: "cas-silent-auction.firebasestorage.app",
  messagingSenderId: "423062787372",
  appId: "1:423062787372:web:c9b424d8e76eb1d6b48889",
};

// Web OAuth client from Firebase Authentication → Google → Web SDK configuration.
const GOOGLE_CLIENT_ID = "423062787372-3fdpdp077o7hse14ap6nrj43aifeejch.apps.googleusercontent.com";

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// A per-browser random id, used only so a guest's own bids can be
// highlighted on their own screen. It is NOT a security mechanism —
// anyone can clear it or fake it. Real identity comes from Google
// sign-in when a bidder chooses to use it.
function getDeviceId() {
  let id = localStorage.getItem("auction_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("auction_device_id", id);
  }
  return id;
}

function money(n) {
  return "\u20B9" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0 });
}

// closesAt on a lot doc can be a Firestore Timestamp (normal case, so
// firestore.rules can enforce it), a JS Date, or an ISO string (legacy).
// This normalizes any of those to millis, or null if there's nothing set.
function closesAtMillis(closesAt) {
  if (!closesAt) return null;
  if (typeof closesAt.toDate === "function") return closesAt.toDate().getTime();
  const t = new Date(closesAt).getTime();
  return isNaN(t) ? null : t;
}

// Lightweight countdown formatter shared by index.html and admin.html.
// Returns null when there's nothing to show, "Closed" once time is up.
function timeLeft(closesAt) {
  const target = closesAtMillis(closesAt);
  if (target == null) return null;
  const ms = target - Date.now();
  if (ms <= 0) return "Closed";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return d + "d " + h + "h left";
  if (h > 0) return h + "h " + m + "m left";
  if (m > 0) return m + "m " + sec + "s left";
  return sec + "s left";
}

// Full status for a lot, folding together the manual "active" flag, an
// optional pre-set bidding duration that hasn't been started yet, and a
// running/expired countdown. This is the single source of truth both
// pages render from.
//   'notstarted' — duration configured, timer not started (never opened)
//   'live'       — accepting bids right now
//   'closed'     — manually closed, or the countdown ran out
function lotStatus(it) {
  if (it.active === false) return { state: "closed", label: "Closed" };
  const target = closesAtMillis(it.closesAt);
  if (target == null) {
    if (it.durationMinutes > 0) return { state: "notstarted", label: "Not started yet" };
    return { state: "live", label: "Open" };
  }
  if (target - Date.now() <= 0) return { state: "closed", label: "Closed" };
  return { state: "live", label: timeLeft(it.closesAt) };
}

// Email approval is stored in Firestore and enforced by server-side rules.
function adminEmail(user) {
  return user && user.email ? user.email.trim().toLowerCase() : '';
}
function adminApprovalRef(user) {
  return db.collection('adminEmails').doc(adminEmail(user));
}
