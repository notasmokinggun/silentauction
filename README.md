# Registration and admin access — updated setup

This version removes Google OAuth from both pages. Guests enter their name,
email and optional phone. Firebase Anonymous Auth keeps their registration
associated with the browser; email and phone are self-reported, with no OTP.
Contact details are stored in private `users/{uid}` documents, not public bids.
Approved organizers can see all registrations on the admin Users page, including
people who have not bid. No emails or SMS are sent automatically.

## Activate this version

1. Firebase Console → Authentication → Sign-in method: enable **Anonymous**
   and **Email/Password**.
2. Authentication → Users → Add user: create the organizer's email/password
   account. Copy its UID. Do not put the password in source code.
3. Firestore → Data: create `admins/{that exact UID}` with a boolean field
   `approved: true`. Only the Firebase project owner/server credentials can
   write approvals; web clients cannot approve themselves. Set it to false
   or delete it to revoke access.
4. Publish `firestore.rules` in Firestore Console → Rules before using the
   new pages. Existing hardcoded admin lists have been removed.
5. Deploy the updated static files to your existing host. Open `admin.html`
   and sign in with the account from step 2. Guests save their registration
   on Profile or automatically when confirming their first bid.

The existing Firebase project configuration is retained. This uses Firebase
Auth and Firestore as the backend and does not require a custom server or
Cloud Functions. Clearing browser storage loses the guest's anonymous session;
entering the same email on another device creates a separate registration.

## Verification checklist

- Register with name/email, both with and without a phone; reload and check
  Profile. Check the same registration appears in admin Users before any bid.
- Reject blank/invalid email and name. A failed write must show an error.
- Confirm a bid and verify it references the authenticated guest UID.
- Sign in with an approved organizer; reload; sign out; try an unapproved
  account and confirm it cannot access organizer data or modify lots.
- Verify ordinary guests cannot read another guest's contact details or write
  `admins` documents. Public bids contain no email or phone fields.

## Repository diagnosis

The old pages used Firebase redirect sign-in while a separate Google client
ID was configured but unused. They did not write user profile documents at
all, and both client and rules admin allowlists were empty. The reported popup
failure could not be reproduced against the deployed site in this environment;
this change removes that OAuth flow rather than asserting a browser-specific
cause. The auction operation guide follows below.


## 4. Run the event

1. In `admin.html`, add each lot: title, a one-paragraph description, a photo (click **Choose photo** — it's compressed and stored automatically, or use "paste an image URL instead" if you already have one hosted), starting bid, and increment.
2. Made a mistake, or something's changing last-minute? Click **Edit** on any lot card to update its title, description, photo, or bid amounts — or **Delete** to pull it entirely. Nothing about the catalog is fixed; it's whatever's in the database right now.
3. Click **Print all QR codes** to get a printable sheet, one QR per lot — tape one next to each item. (Guests can also just open the site once and browse every lot in the wheel, no per-lot scan required.)
4. Guests scan a QR, or open the site directly → scroll the wheel (the background photo changes as they browse) → **Bid on this lot** → enter an amount → **Review bid** → **Confirm bid**. After confirming they land on a success screen and can choose "Bid on another item" or "I'm done bidding."
5. When bidding ends, use **Close bidding** per lot so the app stops accepting new bids on it.
6. Open **Bids & winner** on each lot to see every bid ranked highest to lowest, with a "Set winner" button on each row. Set the top bid as winner; if that person doesn't show up or pay, just click "Set winner" on the next row — the tag on the lot card updates immediately.
7. **Export winners (CSV)** gives you the full ranked bid list for every lot in one sheet (lot, rank, bidder, amount, and which row is marked winner) — useful at checkout if you need to go to the 2nd or 3rd highest bidder.
