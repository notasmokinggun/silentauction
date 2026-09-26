# Silent auction platform — setup guide

Plain HTML/JS, no build step, backed by Firebase (Firestore + Auth). Dark,
premium look with a serif wordmark — bottom-nav app for guests (Home / My
Bids / Profile), full sidebar dashboard for admin.

- **`index.html`** — the whole guest experience. Home tab: category pills +
  a photo grid of lots. Tap a lot → detail page with a sticky **Place a
  Bid** button → a bottom sheet with the amount, quick +₹ buttons, and a
  **Confirm Bid** button → a success screen ("Bid Placed Successfully!")
  with "View Item" / "Keep Browsing". **My Bids** tab tracks what you've
  bid on (Active / Won / Lost), all tracked per-browser, no account
  needed. **Profile** tab holds your display name and optional Google
  sign-in. A per-lot QR code (`?id=...`) jumps straight to that lot.
- **`admin.html`** — sidebar dashboard: **Dashboard** (stat cards, recent
  bids, a bidding-activity chart), **Items** (add/edit/delete lots, with
  in-browser photo compression — no file storage service needed),
  **Bids** (every lot's bids ranked highest→lowest, pick the winner),
  **Users** (everyone who's bid, aggregated), **Payments** (ranked CSV
  export — there's no payment processor built in, this is your reference
  list for checkout), **Settings** (manage other admins, see below).
- **`item.html`** — a one-line redirect to `index.html?id=...`, kept only
  so QR codes printed before this version still work.

## Adding more admins — no email/password anywhere

The first admin (you) gets in via a small hardcoded list in
`firebase-init.js` / `firestore.rules` — that's the only manual step,
ever. Every admin after that is added through the app itself:

1. Have the new person open `admin.html` and **Sign in with Google**.
2. They land on a "not an admin yet" screen showing their UID.
3. You (already an admin) go to **Settings → Manage admins**, paste their
   UID and an optional name, click **Add admin**.
4. They reload the page — they're in. No email, no password, no rules
   file to touch.

Admins can also be removed from that same page (except the bootstrap
admin, which is still edited by hand in the two files above, as the
one fallback that can never lock you out).

## Bid rate limiting

Every bid transaction also writes a small cooldown record
(`bidLimits/{deviceId}`), and `firestore.rules` rejects the *entire*
transaction — bid included — if that device bid within the last 3
seconds. This is enforced server-side, not just in the UI, and needs no
Cloud Function (which would require Blaze) — it's plain Firestore rules
math on a timestamp. Spam-clicking "Confirm Bid" just gets a friendly
"you're bidding too fast" message.

## Staying on the Spark (free) plan — read this

Firestore's free Spark tier caps out at **50,000 reads and 20,000
writes per day**, project-wide. The real risk isn't the bids
themselves — it's **realtime listener fan-out**: every phone with the
site open has a live connection, and every bid pushes an update to
every one of those connections. Rough math: 200 people with the site
open and 300 bids in a night ≈ 60,000 reads from that alone — already
over the free daily cap. Past the cap, Firestore starts rejecting
reads/writes until it resets.

Two honest options:

1. **Reconsider Blaze, but understand what it is.** Not a subscription —
   Spark *plus* paying only for usage past the same free quota. Set a
   budget alert (e.g. $5) in Firebase console → Usage and billing.
   Removes the hard failure mode without really changing your bill.
2. **Stay strictly Spark, reduce fan-out.** Swap the Home grid's live
   listener for a 20-30 second poll instead of a permanent subscription,
   and only open a true realtime listener on the one lot someone's
   actively viewing. Trades a little "instant" feel for a lot of
   headroom. Not built in by default — say the word if you want it wired in.

Photos aren't the bottleneck — Spark's caps are on operation *counts*,
not bytes.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
2. **Build → Firestore Database → Create database** → start in **production mode**.
3. **Build → Authentication → Sign-in method** → enable **Google**.
4. **Project settings → General → Your apps → Add app → Web** (the `</>` icon). Copy the `firebaseConfig` object it gives you.

## 2. Wire up the code

1. Paste that config into `firebase-init.js`, replacing the placeholder values (already done if you're working from the zip already generated for you).
2. Deploy the site anywhere that serves static files — GitHub Pages or Firebase Hosting both work identically, since it's just static HTML/JS/CSS.

## 3. Make yourself the bootstrap admin

1. Open `admin.html` on your deployed site and **Sign in with Google**.
2. You'll land on a "not an admin yet" screen showing your UID.
3. Copy it into **both**:
   - `ADMIN_UIDS` in `firebase-init.js`
   - the bootstrap list inside `isAdmin()` in `firestore.rules`
4. Publish the rules — paste `firestore.rules` straight into **Firestore Database → Rules** in the console (or `firebase deploy --only firestore:rules` if you're using the CLI).
5. Redeploy your hosting for the `firebase-init.js` change, then reload `admin.html` — you're in.

## 4. One-time Firestore index (Dashboard/Bids/Users panels)

The Dashboard, Bids, and Users panels all read every bid across every
lot at once using a Firestore "collection group" query. The **first**
time `admin.html` runs after you deploy, that query will likely fail
with a console error containing a link like
`https://console.firebase.google.com/.../indexes?create_composite=...`.
Click it once (or manually: Firestore → Indexes → Add a **Collection
group** index → collection `bids`, field `timestamp`, descending), wait
a minute for it to build, then reload. This is a one-time setup step,
not a bug.

## 5. Run the event

1. In `admin.html` → **Items**, add each lot: title, category (Art / Experiences / Sports, or type your own), a one-paragraph description, a photo (**Choose photo** — compressed and stored automatically, or "paste an image URL instead"), starting bid, increment, and optionally a closing time.
2. Something changes last-minute? **Edit** any lot's card to update anything about it, or **Delete** to pull it. Nothing is fixed; it's whatever's in the database right now.
3. **Items → Print all QR codes** for a printable sheet, one per lot. Guests can also just open the site and browse the Home grid — no scan required.
4. Guests: Home grid → tap a lot → **Place a Bid** → adjust the amount → **Confirm Bid** → success screen → "Bid on another item" loops back, "Keep Browsing" returns home.
5. When bidding ends, **Items → Close** on each lot to stop new bids.
6. **Bids** panel → **View bids** on a lot → ranked list, **Set winner** on the top row (or a lower one, any time, if the leader doesn't pay).
7. **Payments → Export as CSV** for the full ranked list, every lot, ready for checkout.

## On identity — what this does and doesn't guarantee

- **Name is always required** on every bid.
- **Google sign-in is optional**, attaches a real account ID to a bid — use it as a tie-breaker/verification step on high-value lots.
- The **device ID** is a convenience (remembers a name, and is the rate-limit key), not a security mechanism.
- Someone technical enough could still call the Firestore API directly with a fabricated name — the rules stop a bid that's too low, closed, missing a name, or too fast, but not a determined bad actor. For real money and strangers-to-you, the next hardening step is a **Cloud Function** so nothing writes to Firestore directly from the browser (needs Blaze). Say the word if you want that version.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole guest app: Home grid → item → bid sheet → confirm → success, plus My Bids and Profile tabs |
| `admin.html` | Sidebar dashboard: Dashboard, Items, Bids, Users, Payments, Settings (incl. Manage Admins) |
| `item.html` | Redirects old `?id=` links into `index.html` |
| `firebase-init.js` | Your Firebase config, bootstrap admin UID, and shared helper functions |
| `firestore.rules` | Server-side rules: bidding logic, rate limit, and the two-layer admin check |
