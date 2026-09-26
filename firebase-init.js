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

// ─────────────────────────────────────────────────────────────
// 2. Bootstrap admin(s) only — paste the UID of the FIRST admin (you)
//    here so you can get in at all. After that, add every other admin
//    through the in-app "Manage Admins" page instead (admin.html →
//    Settings) — you should never need to edit this array again except
//    for yourself. This is UI-only; the real enforcement lives in
//    firestore.rules, which needs the SAME uid pasted into its bootstrap
//    list too.
// ─────────────────────────────────────────────────────────────
const ADMIN_UIDS = [
  // "AbCdEfGhIjKlMnOpQrStUvWxYz12",
];

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// A per-browser random id. Used so a guest's own bids can be highlighted,
// AND as the key for the server-enforced bid rate limit (bidLimits/{id} in
// Firestore — see firestore.rules). It is not a login: anyone can clear it,
// which just resets their own rate-limit cooldown, nothing more.
function getDeviceId() {
  let id = localStorage.getItem("auction_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("auction_device_id", id);
  }
  return id;
}

function money(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0 });
}

// Fast, sync, bootstrap-only check — use for an instant UI decision.
function isAdminUid(uid) {
  return !!uid && ADMIN_UIDS.includes(uid);
}

// Authoritative check: bootstrap list OR a live admins/{uid} doc in
// Firestore. Always use this before showing the admin panel — isAdminUid()
// alone would miss anyone added through Manage Admins.
async function checkIsAdmin(uid) {
  if (isAdminUid(uid)) return true;
  try {
    const doc = await db.collection("admins").doc(uid).get();
    return doc.exists;
  } catch {
    return false; // Firestore rules will also block a non-admin regardless.
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Human "time left" text from a Firestore Timestamp (or null for "no deadline set").
function timeLeftText(endsAt) {
  if (!endsAt) return null;
  const end = endsAt.toDate ? endsAt.toDate() : new Date(endsAt);
  const diff = end.getTime() - Date.now();
  if (diff <= 0) return "Ended";
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}m ${secs}s left`;
}

// "My Bids" is tracked per-browser (no account system) — every confirmed bid
// records its own Firestore bid-doc id here, one entry per item (latest wins).
// A bid is provably "mine" later by checking if item.winnerBidId matches the
// id we stored, which works whether or not the bidder used Google sign-in.
function getMyBids() {
  try { return JSON.parse(localStorage.getItem("my_bids") || "[]"); }
  catch { return []; }
}
function recordMyBid(itemId, bidId, amount) {
  const list = getMyBids().filter((b) => b.itemId !== itemId);
  list.push({ itemId, bidId, amount, ts: Date.now() });
  localStorage.setItem("my_bids", JSON.stringify(list));
}
