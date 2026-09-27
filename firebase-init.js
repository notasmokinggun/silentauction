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
// 2. Guest Google sign-in (used in index.html's bid sheet). Web OAuth
//    client ID from Firebase Authentication → Google → Web SDK
//    configuration. Guests only — admins never use Google, see
//    ADMIN_EMAILS below.
// ─────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = "423062787372-3fdpdp077o7hse14ap6nrj43aifeejch.apps.googleusercontent.com";

// ─────────────────────────────────────────────────────────────
// 3. Bootstrap admin(s) only — paste the email of the FIRST admin (you)
//    here, lowercase, exactly as you'll sign in with (email/password —
//    see owner-setup.html for the one-time claim, or just list yourself
//    here directly). That's the one manual step. After that, add every
//    other admin through the in-app Admin Access page (admin-access.html)
//    instead, by typing their email — you should never need to edit this
//    array again except for yourself. This is UI-only; the real
//    enforcement lives in firestore.rules, which needs the SAME email
//    pasted into its bootstrap list too.
// ─────────────────────────────────────────────────────────────
const ADMIN_EMAILS = [
  // "you@example.com",
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

// ─────────────────────────────────────────────────────────────
// Bid guardrails — no negative/zero bids, and anything above
// MAX_BID_AMOUNT (10 crore) is rejected outright and the device is
// temporarily blocked from bidding at all. Enforced here (for a fast,
// friendly message) AND in firestore.rules (bidBlocks + underMaxBid),
// so a tampered client can't bypass either check.
// ─────────────────────────────────────────────────────────────
const MAX_BID_AMOUNT = 100000000; // ₹10,00,00,000 = 10 crore
const BID_BLOCK_MINUTES = 10;

function bidBlockRef() {
  return db.collection("bidBlocks").doc(getDeviceId());
}

// Resolves to a Date the device is blocked until, or null if not blocked.
async function getActiveBidBlock() {
  try {
    const doc = await bidBlockRef().get();
    if (!doc.exists) return null;
    const until = doc.data().blockedUntil;
    const untilDate = until && until.toDate ? until.toDate() : null;
    return untilDate && untilDate.getTime() > Date.now() ? untilDate : null;
  } catch {
    return null; // Rules still enforce this server-side regardless.
  }
}

// Blocks this device from bidding for BID_BLOCK_MINUTES. Called when a
// bid above MAX_BID_AMOUNT is attempted.
async function triggerBidBlock() {
  try {
    await bidBlockRef().set({
      blockedUntil: firebase.firestore.Timestamp.fromDate(
        new Date(Date.now() + BID_BLOCK_MINUTES * 60000)
      ),
    });
  } catch {
    // Best-effort — firestore.rules also rejects any bid attempt while
    // a valid block exists, so this isn't the only line of defense.
  }
}

function minutesLeftText(untilDate) {
  const mins = Math.max(1, Math.ceil((untilDate.getTime() - Date.now()) / 60000));
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

// A concrete mm:ss countdown (not just a rounded-up "X minutes" string) —
// used anywhere a person needs to see exactly how long a block/cooldown has
// left, ticking down in real time.
function countdownText(untilDate) {
  const totalSecs = Math.max(0, Math.round((untilDate.getTime() - Date.now()) / 1000));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────
// Phone number. Mandatory alongside every bidder's email, checked once
// with a simple, deliberately basic rule: 10 digits, starting with 6,
// 7, 8 or 9. No OTP/SMS verification. This project is trusting people
// to enter a real number, not proving it.
// ─────────────────────────────────────────────────────────────
const PHONE_REGEX = /^[6789]\d{9}$/;
function isValidPhone(raw) {
  return PHONE_REGEX.test(String(raw || "").trim());
}
function normalizePhoneInput(raw) {
  // Strips spaces/dashes/+91 so someone pasting "+91 98765 43210" or
  // "098765-43210" still passes the same 10-digit check.
  let digits = String(raw || "").replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

// Fast, sync, bootstrap-only check — use for an instant UI decision.
function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

// Lowercased email for a Firebase Auth user object, or null. This is the
// admin "identity" everywhere in the app — admins/owner are keyed by
// email, never by uid, so approving someone doesn't require them to have
// signed in first.
function adminEmail(user) {
  return user && user.email ? user.email.toLowerCase() : null;
}

// The adminEmails/{email} doc for a user — the single source of truth for
// "is this person approved", written by admin-access.js (adding/removing
// admins) and owner-setup.js (claiming ownership). firestore.rules trusts
// this same collection, keyed the same way.
function adminApprovalRef(user) {
  const email = adminEmail(user);
  return email ? db.collection("adminEmails").doc(email) : null;
}

// Authoritative check: bootstrap list OR a live adminEmails/{email} doc
// with approved === true. Takes a plain lowercase email string, so it
// works BEFORE any Firebase Auth account/user object exists — this is
// what gates account creation itself in admin.html's "Create Password"
// flow, since there's no server-side function to block Auth signup
// directly and this is the one source of truth the client can check.
async function isApprovedAdminEmail(email) {
  if (!email) return false;
  if (isAdminEmail(email)) return true;
  try {
    const doc = await db.collection("adminEmails").doc(email).get();
    return doc.exists && doc.data().approved === true;
  } catch {
    return false; // Firestore rules will also block a non-admin regardless.
  }
}

// Same check as isApprovedAdminEmail, but for the ONE call site — the
// pre-signup gate in admin.html — where silently returning "false" on
// error is actively misleading: a genuinely-approved email would look
// identical to an unapproved one if the read itself fails (e.g. the
// project's live Firestore rules are an older version that still
// restricts reading adminEmails/{email}, which only takes effect once
// someone manually re-publishes firestore.rules in the Firebase console
// — a git push/merge does NOT do this). Returns { approved, error }:
// error is null on a normal read, or a message to show the person when
// the read itself couldn't be completed, so "not approved" and
// "couldn't check" are never confused with each other.
async function checkAdminApprovalStatus(email) {
  if (!email) return { approved: false, error: null };
  if (isAdminEmail(email)) return { approved: true, error: null };
  try {
    const doc = await db.collection("adminEmails").doc(email).get();
    return { approved: doc.exists && doc.data().approved === true, error: null };
  } catch (err) {
    return {
      approved: false,
      error: err.code === "permission-denied"
        ? "Couldn't check approval status (permission denied). The live Firestore rules on this project may be out of date — re-publish the current firestore.rules in the Firebase console, then try again."
        : "Couldn't check approval status: " + err.message,
    };
  }
}

// Authoritative check: bootstrap list OR a live adminEmails/{email} doc
// with approved === true. Always use this before showing the admin
// panel — isAdminEmail() alone would miss anyone added through Admin
// Access. Takes a Firebase Auth user object (needs .email).
async function checkIsAdmin(user) {
  if (!user || !user.email) return false;
  return isApprovedAdminEmail(adminEmail(user));
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
