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

1. Firebase Authentication → Sign-in method: enable **Google** and **Email/Password**.
2. Confirm the Google Web client ID matches `GOOGLE_CLIENT_ID` in `firebase-init.js`.
   In Google Cloud → APIs & Services → Credentials → that OAuth client, add the
   exact origin to Authorized JavaScript origins (for GitHub Pages:
   `https://notasmokinggun.github.io`, without `/silentauction`). Add the hostname
   to Firebase Authentication → Settings → Authorized domains as well.
3. In Firestore Console → Rules, paste and publish **firestore.rules** from this
   branch. Alternatively run `firebase deploy --project cas-silent-auction --only firestore:rules`.
4. Publish the static files, including `guest-auth.js`, `admin-access.html`,
   `admin-access.js`, `firebase-init.js` and `admin.html`.

### First admin: approve your email once in Firebase Console

Create collection **adminEmails**, with a document whose ID is your full email
address **in lowercase**, for example `you@example.com`. Add these fields:

| Field | Type | Value |
|---|---|---|
| email | string | your lowercase email |
| approved | boolean | true |
| role | string | owner |

Then open `admin.html`, enter that email and a password, and click **Create admin
account**. Open the verification email, return to the page, and click **I've
verified my email / Check access**. Existing accounts can sign in and use **Send
verification email** if needed. Existing Google-only accounts can use **Reset
password** to set up password access. Never put passwords in Firestore.

This owner approval cannot be edited or removed from the website. Only the
Firebase project owner can change it in the Console. This prevents the admin
page from accidentally removing the last protected owner. You do not copy a UID.

### Add or remove other admin emails

Go to **Admin → Settings → Manage admin access**. Enter the organizer's email and
click **Add admin**. That saves an approval in Firestore; it does not create an
Authentication account or send an invitation. The organizer creates their own
email/password account on `admin.html`, verifies the email, then signs in.
Existing verified accounts can sign in immediately. Account creation alone never
grants admin permissions; an approved email AND verified ownership are required.

**Remove admin** deletes that email's approval. Firestore rules reject subsequent
admin requests even with an existing login session. The person's Firebase Auth
account and guest bids remain. Admins cannot remove themselves or edit/remove an
owner. All approved admins can manage other non-owner admins.

The browser requests Firestore operations using its normal Firebase SDK, but the
backend rules decide whether those operations are allowed. The email list lives
in the private `adminEmails` collection, not in JavaScript. Writes validate the
email, role, actor UID and server timestamp. No browser can create an owner role.

### Migration from the earlier branch revision

The earlier `admins/{UID}` approvals are no longer used. Create the first
`adminEmails/{lowercase-email}` owner document before using this revision and
publish the new rules. Old approval documents can be left in place; the new rules
make them inaccessible and they grant no permissions. The functions directory
and callable endpoints were removed from the project. No functions deployment
or Blaze subscription is needed.

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
4. Guests scan a QR, or open the site directly → scroll the wheel (the background photo changes as they browse) → **Bid on this lot** → enter an amount → **Review bid** → **Confirm bid**. After confirming they land on a success screen and can choose "Bid on another item" or "I'm done bidding."
5. When bidding ends, use **Close bidding** per lot so the app stops accepting new bids on it.
6. Open **Bids & winner** on each lot to see every bid ranked highest to lowest, with a "Set winner" button on each row. Set the top bid as winner; if that person doesn't show up or pay, just click "Set winner" on the next row — the tag on the lot card updates immediately.
7. **Export winners (CSV)** gives you the full ranked bid list for every lot in one sheet (lot, rank, bidder, amount, and which row is marked winner) — useful at checkout if you need to go to the 2nd or 3rd highest bidder.
