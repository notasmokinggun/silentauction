# Silent auction — Google guests and approved admins

Guests tap **Continue with Google**, choose an account, and their name and email
are saved automatically. No guest password, UID entry, manual registration form,
or OTP is required. Phone is optional and can be saved afterward from Profile.
The Explore Items button has a 64px minimum height.

Admin access remains email/password with backend approval. Guest contact details
are private `users/{uid}` documents, readable only by that user and approved
admins. UID is an internal database key, never something a guest must enter.
No emails or SMS are sent automatically.

## Spark-only setup (no billing upgrade)

This version uses Firebase Authentication and Cloud Firestore on **Spark**.
There are no Cloud Functions, Admin SDK, service-account credentials, or paid
extensions. The static site can stay on GitHub Pages. Firestore's server-side
security rules enforce every admin read/write; changing browser code cannot
approve an unapproved user. Normal Spark quotas still apply.

1. Firebase Authentication → Sign-in method: enable **Google**, **Email/Password**, and
   **Email link (passwordless sign-in)** — the last one powers the admin "Create Password"
   setup link and must be turned on for new admins to be able to get in.
2. Confirm the Google Web client ID matches `GOOGLE_CLIENT_ID` in `firebase-init.js`.
   In Google Cloud → APIs & Services → Credentials → that OAuth client, add the
   exact origin to Authorized JavaScript origins (for GitHub Pages:
   `https://notasmokinggun.github.io`, without `/silentauction`). Add the hostname
   to Firebase Authentication → Settings → Authorized domains as well.
3. In Firestore Console → Rules, paste and publish **firestore.rules** from this
   branch. Alternatively run `firebase deploy --project cas-silent-auction --only firestore:rules`.
4. Publish the static files, including `owner-setup.html`, `owner-setup.js`, `guest-auth.js`, `admin-access.html`,
   `admin-access.js`, `firebase-init.js` and `admin.html`.

### First owner: guided setup

Follow [SETUP.md](SETUP.md) for the beginner walkthrough.

In Firebase Console create collection `setupKeys`, click **Auto-ID** for the
document ID, copy that random ID, and add just `enabled` (boolean) = `true`.
Keep the ID private. Open `owner-setup.html` on the published site, create or
sign in to your email/password account, verify your email, and paste that ID.
Click **Make this my owner account**. No email or UID needs to be hardcoded.

An atomic write saves your account UID/email in private `settings/owner`, creates
your `adminEmails/{email}` owner approval, and disables the setup key. Owner setup
cannot run again, even with another key. The website cannot replace or delete
the owner. Account recovery or an intentional owner change requires the Firebase
project owner to use the Console. Your chosen email must be yours to verify.

### Only the owner can add or remove other admins

Open **Admin → Settings → Manage admin access**. Enter an organizer's email and
click **Add admin**. They then go to `admin.html`, enter that email, and tap
**Create Password** — this sends a one-click sign-in link that creates and
verifies their account in one step, then prompts them to choose a password.
Existing accounts can sign in immediately. Adding an email alone does not
create an account or send anything; nothing happens until they visit
`admin.html` and tap Create Password.

Only the stored owner UID AND verified owner email can list/manage approvals.
Other approved admins can manage auction lots and read guest registrations,
but cannot grant or revoke admin permissions. This is enforced by Firestore
rules, not just by hiding controls. Revocation keeps guest accounts/bids intact.
The owner cannot be removed through the website.

### Migration from earlier branch revisions

The old `admins/{UID}` documents are ignored. If you created an owner email record
using the previous instructions but have not completed the new setup, run the
setup page once with your intended owner account. It will update the matching
email approval and lock the single owner identity in `settings/owner`. Existing
ordinary admin approvals remain usable, but cannot approve others.

No Cloud Functions, Blaze subscription, or service-account keys are needed.

### Checks

```sh
npm install
npm test
npm run test:rules
```

The rules tests use a local Firestore emulator and demo project, never production.
They check unauthorized/self-approval attempts, email verification, owner
protection, revocation, and malformed writes. Java 17+ is required with the
pinned emulator CLI. On the live site, also test email verification delivery,
Google sign-in, and admin access after the rules and pages have been published.
The testing packages are development tools, not dependencies for the hosted site.

## How sign-in completes

`guest-auth.js` loads Google Identity Services and renders its standard button.
The Google callback supplies an ID token to Firebase `signInWithCredential`.
Firebase verifies it and establishes a persistent session; the app then saves
name/email, preserves any existing phone, updates both Profile and the bid sheet,
and displays confirmation. Auth restoration repeats this process after reload.
Errors are visible, and failed profile writes have a retry button. Contact details
are never added to public bid documents. Rules require a Google-authenticated
session and match the profile email against the verified Firebase token.

This avoids the previous Firebase cross-domain popup/redirect relay. The reported
live failure has not been reproduced here; production OAuth origin configuration
and real account sign-in still need verification. If the deployment sends a
Cross-Origin-Opener-Policy header that interferes with popups, configure it as
`same-origin-allow-popups` per Google's setup guide.

References:
- https://developers.google.com/identity/gsi/web/reference/js-reference
- https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- https://firebase.google.com/docs/auth/web/google-signin

## Verification

Run `node --test tests/guest-auth.test.cjs` for the mocked credential exchange,
profile saving, restore, optional phone, and failure handling checks.
On the deployed site, test Google sign-in, reload, sign-out, another account,
profile-save permission failure, optional phone saving, and bidding. Verify an
approved email/password admin can see registrations and an unapproved account
cannot manage lots or read guest contacts. These live checks require configured
Firebase/Google access and are not covered by the mocked tests.

## 4. Run the event

1. In `admin.html`, add each lot: title, a one-paragraph description, a photo (click **Choose photo** — it's compressed and stored automatically, or use "paste an image URL instead" if you already have one hosted), starting bid, and increment.
2. Made a mistake, or something's changing last-minute? Click **Edit** on any lot card to update its title, description, photo, or bid amounts — or **Delete** to pull it entirely. Nothing about the catalog is fixed; it's whatever's in the database right now.
3. Click **Print all QR codes** to get a printable sheet, one QR per lot — tape one next to each item. (Guests can also just open the site once and browse every lot in the wheel, no per-lot scan required.)
4. Guests scan a QR, or open the site directly → browse the catalog grid (search and category filters at the top) → open a lot → **Place a Bid** → enter an amount → **Confirm Bid**. After confirming they land on a success screen and can choose to view the item or keep browsing.
5. When bidding ends, use **Close bidding** per lot so the app stops accepting new bids on it.
6. Open **Bids & winner** on each lot to see every bid ranked highest to lowest, with a "Set winner" button on each row. Set the top bid as winner; if that person doesn't show up or pay, just click "Set winner" on the next row — the tag on the lot card updates immediately.
7. **Export winners (CSV)** gives you the full ranked bid list for every lot in one sheet (lot, rank, bidder, amount, and which row is marked winner) — useful at checkout if you need to go to the 2nd or 3rd highest bidder.
