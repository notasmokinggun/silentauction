# Silent auction — Google guests and approved admins

Guests tap **Continue with Google**, choose an account, and their name and email
are saved automatically. No guest password, UID entry, manual registration form,
or OTP is required. Phone is optional and can be saved afterward from Profile.
The Explore Items button has a 64px minimum height.

Admin access remains email/password with backend approval. Guest contact details
are private `users/{uid}` documents, readable only by that user and approved
admins. UID is an internal database key, never something a guest must enter.
No emails or SMS are sent automatically.

## One-time setup

1. Firebase Console → Authentication → Sign-in method: enable **Google** and
   **Email/Password**. Anonymous authentication is no longer used by the guest page.
2. Google provider → Web SDK configuration: confirm its Web client ID matches
   `GOOGLE_CLIENT_ID` in `firebase-init.js`.
3. In Google Cloud Console → APIs & Services → Credentials, open that web OAuth
   client and add the exact deployed origin to **Authorized JavaScript origins**.
   For GitHub Pages this is `https://notasmokinggun.github.io` (no repository path).
   Add any custom domain too. In Firebase Authentication → Settings → Authorized
   domains, add the deployed hostname. Serve through HTTPS, not a local file.
4. Authentication → Users → Add user: create the organizer email/password account.
   Copy its UID. In Firestore create `admins/{that UID}` with boolean `approved: true`.
   This is organizer setup only. Browser clients cannot grant approval. Delete the
   document or set approved to false to revoke access.
5. Publish `firestore.rules` and deploy all updated static files, including
   **guest-auth.js**. Then test on the deployed domain before the event.

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
