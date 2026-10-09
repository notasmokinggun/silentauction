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

## Adding more admins — allowlist first, no email ever sent

The first admin (you, the owner) gets in via a small hardcoded list in
`firebase-init.js` / `firestore.rules`, or by claiming ownership through
`owner-setup.html` with a one-time setup code — that's the only manual step,
ever. Every admin after that is added through the app itself, by email:

1. You (the owner) go to **Admin Access** (`admin-access.html`, or Settings →
   Manage admin access), type the new person's email, and click **Add
   admin**. This only writes their email to an allowlist (`adminEmails` in
   Firestore) — nothing is sent to them.
2. They open `admin.html`, enter that exact email, choose their own
   password, and tap **Create Password**. The app checks the allowlist
   first: if the email isn't approved, no account is created at all — they
   simply can't sign up. If it is approved, their account is created
   immediately and they're in — no verification link, no password emailed,
   no waiting.

There is no email-based password reset either, for the same reason: nothing
is ever emailed. If an admin forgets their password, the owner deletes
their account in the Firebase console (Authentication tab) and they run
**Create Password** again.

Admins can also be removed from the Admin Access page (except the bootstrap
admin, which is still edited by hand in the two files above, as the one
fallback that can never lock you out).

## Welcome gallery, instructions and Results

- **Welcome photos:** put numbered photos in `images/welcome/` (`1.jpg`, `2.jpg`, ...).
  They crossfade behind the welcome card. With no `1.*` file the original dark
  welcome shows. See `images/welcome/README.md`.
- **Instructions:** shown once per device after "Explore All Items", and any
  time from Profile → How bidding works. Edit the text in `index.html`
  (`#view-guide`).
- **Results tab:** live highest bid per lot, then the winners once you use
  **Set winner** in the admin Bids panel.
- **Child's name and grade:** every bid needs them (grade 6 to 12). Only admins
  see them, in the Bids panel and the CSV export.

## Large bids need a confirmation call

Any bid at or above **5x the current price** (or 5x the increment when the
current bid is 0) is not placed on the lot. It is stored as a pending hold:

1. The bidder sees "on hold, we'll call you" and the lot's price does not move.
2. In **Admin → Bids**, a red banner and a badge show pending holds. A reviewer
   calls the number on the bid and asks if they really meant that amount.
3. The reviewer taps **Confirm** (the bid becomes real, and leads if it still
   beats the current bid) or **Revoke** (it never counts). The bidder can also
   withdraw a pending hold themselves.

The 5x rule lives in `firestore.rules` and `HOLD_MULTIPLIER` in
`firebase-init.js`. Change both together. Phone numbers are not OTP-verified;
the call is the check.

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
2. You'll land on a "not an admin yet" screen showing your email.
3. Copy it into **both**:
   - `ADMIN_EMAILS` in `firebase-init.js` (lowercase, exactly as Google shows it)
   - the bootstrap list inside `isAdmin()` in `firestore.rules`
   - the bootstrap list inside `isAdmin()` in `firestore.rules`
4. Publish the rules — paste `firestore.rules` straight into **Firestore Database → Rules** in the console (or `firebase deploy --only firestore:rules` if you're using the CLI).
5. Redeploy your hosting for the `firebase-init.js` change, then reload `admin.html` — you're in.

## Bidder phone numbers

Every bid requires a phone number alongside the bidder's (Google-verified)
email, no OTP, just a basic format check enforced both in the browser and
in `firestore.rules`: 10 digits, starting with 6, 7, 8, or 9. It's shown next
to each bid in the admin **Bids** panel and in the **Users** panel, so you
can actually reach a bidder to confirm a high bid is real before relying on
it.

## Revoking a bid

**Bids** panel → **View bids** on a lot → **Revoke bid** on any row. This
permanently removes that bid and recalculates the lot's leading bid from
whatever's left (or resets to the starting bid if nothing remains). If the
revoked bid was the marked winner, that's cleared too. There's no "undo" —
it's a real delete, same as removing a lot.

## 4. One-time Firestore index (Dashboard/Bids/Users panels)

Nothing to do here — the Dashboard, Bids, Users, and Payments panels each
read bids straight from each lot's own `bids` subcollection (one listener
per lot), not a cross-collection query, so there's no manual Firestore
index to create. If you're seeing empty panels, it's a genuine connectivity/
permissions issue, not a missing index — check the browser console.

## 5. Run the event

1. In `admin.html` → **Items**, add each lot: title, category (Art / Experiences / Sports, or type your own), a one-paragraph description, a photo (**Choose photo** — compressed and stored automatically, or "paste an image URL instead"), starting bid, increment, and optionally a closing time.
2. Something changes last-minute? **Edit** any lot's card to update anything about it, or **Delete** to pull it. Nothing is fixed; it's whatever's in the database right now.
3. **Items → Print all QR codes** for a printable sheet, one per lot. Guests can also just open the site and browse the Home grid — no scan required.
4. Guests: Home grid → tap a lot → **Place a Bid** → adjust the amount → **Confirm Bid** → success screen → "Bid on another item" loops back, "Keep Browsing" returns home.
5. When bidding ends, **Items → Close** on each lot to stop new bids.
6. **Bids** panel → **View bids** on a lot → ranked list, **Set winner** on the top row (or a lower one, any time, if the leader doesn't pay).
7. **Payments → Export as CSV** for the full ranked list, every lot, ready for checkout.

## On identity — what this does and doesn't guarantee

- **Name and phone number are always required** on every bid.
- **Google sign-in is optional**, attaches a real account ID to a bid — use it as a tie-breaker/verification step on high-value lots.
- The **device ID** is a convenience (remembers a name, and is the rate-limit key), not a security mechanism.
- Someone technical enough could still call the Firestore API directly with a fabricated name — the rules stop a bid that's too low, closed, missing a name, or too fast, but not a determined bad actor. For real money and strangers-to-you, the next hardening step is a **Cloud Function** so nothing writes to Firestore directly from the browser (needs Blaze). Say the word if you want that version.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole guest app: Home grid → item → bid sheet → confirm → success, plus My Bids and Profile tabs |
| `admin.html` | Sidebar dashboard: Dashboard, Items, Bids, Users, Payments, Settings (incl. Manage Admins) |
| `item.html` | Redirects old `?id=` links into `index.html` |
| `firebase-init.js` | Your Firebase config, bootstrap admin email, and shared helper functions |
| `firestore.rules` | Server-side rules: bidding logic, rate limit, and the two-layer admin check |

## Security and legal checklist (read before each event)

1. **Publish the rules.** Pushing `firestore.rules` to GitHub does **not** change the live
   database. Run `firebase deploy --only firestore:rules`, or paste the file into
   Firebase console → Firestore → Rules → Publish. Then run `npm run test:rules` locally
   (needs the emulator, which downloads on first run).
2. **Fill in `ORG` at the bottom of `legal.html`** (organiser name, contact email/phone, city,
   retention wording). Empty fields fall back to neutral wording.
3. **Firebase console:** turn on App Check (reCAPTCHA) and enforce it for Firestore and
   Authentication; restrict the web API key to this site's domain (Google Cloud console →
   APIs & Services → Credentials); in Authentication, keep only Google, Anonymous and
   Email/Password enabled; set the authorised domains to this site only.
4. **After the event:** delete bids (`items/*/bids`), `bidLimits`, `bidBlocks`, `users`, and the
   anonymous Auth users, as promised in the privacy notice.
5. The site stores only essential data in the browser (see the Cookies & storage section of
   `legal.html`). If you add analytics, ads or any new storage key, update that page and add
   a consent step first.

## Paper bids and desk helpers

For guests who bid on paper. In **Admin → Bids**, pick a lot in the dropdown next to
**Print A4 bid details sheet** to print a sheet with that lot's number, name, highest bid and
minimum next bid filled in (leave it on "Blank sheet" for a generic one). The guest fills in the rest
by hand, including whether their name may be announced.

To key those sheets in, create a **desk helper** under **Admin → Settings → Desk helpers**: give a
name, a login email (it can be made up, no email is ever sent) and a password. Send them
`desk.html` and the login. A helper can only choose a lot and enter a paper bid. They cannot see any
bids, phone numbers, users or payments, and cannot open the admin page. Switch a helper off or remove
them in the same place and the login stops working immediately.

- Paper bids behave like online ones: same phone, class and increment checks; they show in the admin
  Bids list tagged "Paper bid" and in the CSV (Source column).
- Bids ₹4,000 or more above the lot's current price are **held** until you confirm by phone, exactly like online ones. Bids of
  ₹50,000 or more cannot be entered by a helper.
- A helper cannot edit or undo a bid. Fix a mistake with **Revoke** in the admin Bids list.
- Publish the updated `firestore.rules` before using this (it adds the `desks` collection and the paper-bid
  rules), and run `npm run test:rules` first.
