# Silent auction platform — setup guide

Plain HTML/JS, no build step, backed by Firebase (Firestore + Auth).

- **`index.html`** — the whole guest experience: a photo-backed scroll
  wheel to browse lots, tap to review a lot, enter a bid, a hard
  **confirm** step before it's submitted, then a success screen that
  asks "bid on another item?". A per-lot QR code (`?id=...`) jumps
  straight to that lot's bid step, skipping the wheel.
- **`admin.html`** — add, edit, and delete lots (title, one-paragraph description, a photo, starting bid, increment) — nothing is hardcoded, everything guests see comes from what you enter here. Photos are compressed in the browser and stored directly in the database, no separate file storage service needed. Once bidding ends, open **Bids & winner** on any lot to see every bid ranked highest to lowest and mark the winner. If a winner doesn't pay, click "Set winner" on the next row down.
- **`item.html`** — a one-line redirect to `index.html?id=...`, kept
  only so QR codes printed before this version still work.

## Staying on the Spark (free) plan — read this

You've decided against Blaze, so here's the honest tradeoff, not just the happy path.

Firestore's free Spark tier caps out at **50,000 reads and 20,000 writes per day**, project-wide. The part that actually eats into that at an event isn't the bids themselves (a few hundred bids is a few hundred writes — nothing) — it's **realtime listener fan-out**: every phone with the catalog open has a live connection, and every single bid pushes an update to every one of those open connections. Rough math: if 200 people have the site open at once and 300 bids happen over the night, that's roughly 200 × 300 = 60,000 reads from that alone — already over the free daily cap. Once you hit the cap, Firestore starts rejecting reads/writes until it resets, which for a live auction means bidding could visibly break mid-event.

Two honest ways to handle this:

1. **Reconsider Blaze, but understand what it actually is.** Blaze isn't a subscription — it's Spark *plus* the option to pay only for usage past the same free daily quota. You can set a budget alert (e.g. $5) in Firebase console → Usage and billing, and in practice a single event rarely costs more than a few dollars, often nothing at all if you stay near the free limits. It removes the hard failure mode without meaningfully changing your bill.
2. **Stay strictly Spark and reduce fan-out.** The biggest lever is not holding a permanent realtime listener on the whole catalog for every guest — e.g. refresh the wheel's bid amounts every 20-30 seconds instead of a live subscription, and only open a true realtime listener on the one lot someone's actively bidding on. This trades a little bit of "instant" for a lot of headroom. I didn't build this in by default since it's a real tradeoff (less live-feeling UI) — say the word if you want me to wire it in.

Photos themselves aren't the bottleneck here — Spark's caps are on operation *counts*, not bytes, and a compressed photo or two per lot is nothing against the 1 GiB total storage cap.

## Why Firebase at all

Firestore's transactions make the "only accept a higher bid" logic safe even when two people tap Confirm at the same moment, and Auth gives you Google Sign-In for free. That's the whole reason it's Firebase instead of a plain database — everything else (Storage, Blaze) is optional and, per above, currently switched off.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
2. **Build → Firestore Database → Create database** → start in **production mode**.
3. **Build → Authentication → Sign-in method** → enable **Google**.
4. **Project settings → General → Your apps → Add app → Web** (the `</>` icon). Copy the `firebaseConfig` object it gives you.

## 2. Wire up the code

1. Paste that config into `firebase-init.js`, replacing the `PASTE_ME` values.
2. Deploy the site anywhere that serves static files — Firebase Hosting is the easiest since it's already the same project:
   ```
   npm install -g firebase-tools
   firebase login
   firebase init hosting    # point it at this folder, single-page app: No
   firebase deploy
   ```
   You'll get a `https://<project-id>.web.app` URL — that's what your QR codes will point to.

## 3. Make yourself an admin

1. Open `admin.html` on your deployed site and **Sign in with Google**.
2. You'll land on a "not an admin yet" screen showing your UID.
3. Copy it into **both**:
   - `ADMIN_UIDS` in `firebase-init.js`
   - the `isAdmin()` list in `firestore.rules`
4. Publish the rules — either paste `firestore.rules` straight into **Firestore Database → Rules** in the console, or if you're using the Firebase CLI: `firebase deploy --only firestore:rules`.
5. Redeploy your hosting for the `firebase-init.js` change, then reload `admin.html` — you're in.

## 4. Run the event

1. In `admin.html`, add each lot: title, a one-paragraph description, a photo (click **Choose photo** — it's compressed and stored automatically, or use "paste an image URL instead" if you already have one hosted), starting bid, and increment.
2. Made a mistake, or something's changing last-minute? Click **Edit** on any lot card to update its title, description, photo, or bid amounts — or **Delete** to pull it entirely. Nothing about the catalog is fixed; it's whatever's in the database right now.
3. Click **Print all QR codes** to get a printable sheet, one QR per lot — tape one next to each item. (Guests can also just open the site once and browse every lot in the wheel, no per-lot scan required.)
4. Guests scan a QR, or open the site directly → scroll the wheel (the background photo changes as they browse) → **Bid on this lot** → enter an amount → **Review bid** → **Confirm bid**. After confirming they land on a success screen and can choose "Bid on another item" or "I'm done bidding."
5. When bidding ends, use **Close bidding** per lot so the app stops accepting new bids on it.
6. Open **Bids & winner** on each lot to see every bid ranked highest to lowest, with a "Set winner" button on each row. Set the top bid as winner; if that person doesn't show up or pay, just click "Set winner" on the next row — the tag on the lot card updates immediately.
7. **Export winners (CSV)** gives you the full ranked bid list for every lot in one sheet (lot, rank, bidder, amount, Google-verified, and which row is marked winner) — useful at checkout if you need to go to the 2nd or 3rd highest bidder.

## On identity — what this does and doesn't guarantee

- **Name is always required**, shown on the live feed, and stored on every bid.
- **Google sign-in is optional** and attaches a real account ID to a bid — use it as your tie-breaker or verification step for the *winning* bid on high-value lots, and reserve final confirmation (checking a name against a real person) for checkout.
- The **device ID** stored in the browser is a convenience only (lets someone's own name pre-fill next time), not a security mechanism — it resets if someone clears their browser or borrows a friend's phone. Don't rely on it to stop one person bidding under two names.
- The Firestore rules stop a bid that's too low, closed, or missing a name, and they cap what a normal bid can touch — but someone technical enough could still call the Firestore API directly with a fabricated name. For a casual event this is a non-issue; if real money and strangers-to-you are involved, the next hardening step is moving the bid-validation logic into a **Cloud Function** so nothing writes to Firestore directly from the browser. Happy to build that version if you want it.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole guest flow: wheel picker → bid → confirm → success |
| `admin.html` | Add/edit/delete lots (with in-browser photo compression), print QR sheet, pick winners per lot, export ranked CSV |
| `item.html` | Redirects old `?id=` links into `index.html` |
| `option-wheel.js` / `option-wheel.css` | The scroll-wheel lot picker (vanilla JS) |
| `firebase-init.js` | Your Firebase config + admin UID allowlist (shared by all pages) |
| `firestore.rules` | Server-side bidding rules — publish via the Firestore Rules tab or `firebase deploy --only firestore:rules` |
