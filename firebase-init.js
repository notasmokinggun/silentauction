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

// A lot is closed if an admin closed it OR its deadline (endsAt) has passed.
// Use this everywhere instead of checking `active === false` directly.
// (firestore.rules also rejects bids after endsAt, so this is the friendly half.)
function isClosed(it) {
  if (!it) return false;
  if (it.active === false) return true;
  const e = it.endsAt;
  if (!e) return false;
  const t = e.toDate ? e.toDate().getTime() : new Date(e).getTime();
  return Number.isFinite(t) && t <= Date.now();
}

// Who won / at what price. "Set winner" writes winnerName/winnerAmount and does
// NOT touch currentBidderName/currentBid, so prefer the winner fields.
function winnerNameOf(it) { return it.winnerName ?? it.currentBidderName; }
function winnerAmountOf(it) { return it.winnerAmount ?? it.currentBid; }

function money(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0 });
}

// ─────────────────────────────────────────────────────────────
// Bid guardrails. Two flat, absolute thresholds (not relative to the
// current price — easy for anyone to reason about):
//   - Above HOLD_THRESHOLD (₹20,000): the bid is held, not applied to the
//     lot, until our team calls to confirm it.
//   - At or above BAN_THRESHOLD (₹1,00,000): rejected outright, and the
//     bidder's account (uid, not device — can't be dodged by clearing
//     local storage) is temporarily banned from bidding for BAN_MINUTES.
// Enforced here (for a fast, friendly message) AND in firestore.rules,
// so a tampered client can't bypass either check.
// ─────────────────────────────────────────────────────────────
const HOLD_THRESHOLD = 20000; // ₹20,000
const BAN_THRESHOLD = 100000; // ₹1,00,000
const BAN_MINUTES = 5;
const MAX_BID_AMOUNT = 100000000; // ₹10,00,00,000 — absolute ceiling, same as firestore.rules
function isHoldAmount(it, amount) { return amount > HOLD_THRESHOLD; }
function isBanAmount(amount) { return amount >= BAN_THRESHOLD; }

function banRef(uid) {
  return db.collection("bidLimits").doc(uid);
}

function deviceBanRef() {
  return db.collection("bidBlocks").doc(getDeviceId());
}
async function readBanDate(ref) {
  try {
    const doc = await ref.get();
    if (!doc.exists) return null;
    const until = doc.data().bannedUntil;
    const untilDate = until && until.toDate ? until.toDate() : null;
    return untilDate && untilDate.getTime() > Date.now() ? untilDate : null;
  } catch {
    return null; // Rules still enforce this server-side regardless.
  }
}
// Resolves to a Date this account is banned until, or null if not banned.
// Email-only (anonymous) guests are also blocked by their device id.
async function getActiveBan(uid) {
  const user = firebase.auth().currentUser;
  const [a, b] = await Promise.all([
    readBanDate(banRef(uid)),
    user && user.isAnonymous ? readBanDate(deviceBanRef()) : Promise.resolve(null),
  ]);
  if (a && b) return a > b ? a : b;
  return a || b;
}

// Bans this account from bidding for BAN_MINUTES. Called when a bid of
// BAN_THRESHOLD or more is attempted.
async function triggerBan(uid) {
  try {
    const until = firebase.firestore.Timestamp.fromDate(
      new Date(Date.now() + BAN_MINUTES * 60000)
    );
    await banRef(uid).set({ bannedUntil: until });
    // Also ban this device, so an email-only guest can't just re-enter a different email.
    await deviceBanRef().set({ bannedUntil: until }).catch(() => {});
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

// ─────────────────────────────────────────────────────────────
// Class & Section — one of two ways (alongside admission number) a
// family can be identified. A space or a dash is REQUIRED between the
// class number and the section, deliberately, so the two parts can be
// read back apart and tracked separately ("10-B" / "10 B") rather than
// landing as one unparseable string ("10B").
// ─────────────────────────────────────────────────────────────
const CLASS_SECTION_REGEX = /^[0-9]{1,2}[ -][A-Za-z0-9]{1,4}$/;

// Admission number — the other option, a plain 4-digit number.
const ADMISSION_NUMBER_REGEX = /^[0-9]{4}$/;

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
        ? "Couldn't check approval status (permission denied). The live Firestore rules on this project may be out of date. Re-publish the current firestore.rules in the Firebase console, then try again."
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
function removeMyBid(itemId, bidId) {
  const list = getMyBids().filter((b) => !(b.itemId === itemId && (!bidId || b.bidId === bidId)));
  localStorage.setItem("my_bids", JSON.stringify(list));
}
function recordMyBid(itemId, bidId, amount, status) {
  const list = getMyBids().filter((b) => b.itemId !== itemId);
  list.push({ itemId, bidId, amount, ts: Date.now(), status: status || null });
  localStorage.setItem("my_bids", JSON.stringify(list));
}

// Pulls this account's bids from the server (all lots, one query) so My Bids
// survives a new device or cleared storage, and so a held bid shows its real
// status (pending / confirmed / revoked). Needs the bids.uid collection-group
// index exemption (firestore.indexes.json). If that query fails for any
// reason, it quietly keeps whatever is in localStorage.
async function syncMyBidsFromServer(uid) {
  if (!uid) return false;
  try {
    const snap = await db.collectionGroup("bids").where("uid", "==", uid).get();
    const latest = new Map();
    snap.forEach((d) => {
      const data = d.data();
      const itemId = d.ref.parent.parent.id;
      const ts = data.timestamp && data.timestamp.toDate ? data.timestamp.toDate().getTime() : 0;
      const prev = latest.get(itemId);
      if (!prev || ts >= prev.ts) {
        latest.set(itemId, { itemId, bidId: d.id, amount: data.amount, ts, status: data.status || null });
      }
    });
    localStorage.setItem("my_bids", JSON.stringify([...latest.values()]));
    return true;
  } catch (err) {
    console.warn("Could not sync My Bids from the server:", err.code || err.message);
    return false;
  }
}
