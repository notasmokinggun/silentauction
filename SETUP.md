# Beginner setup — Firebase Spark

Yes, a few one-time settings are required. Pushing files to GitHub does not
update Firebase settings or publish database rules. You do not need Blaze.
Use the existing **cas-silent-auction** project throughout.

## 1. Publish the current website files

The changes are on branch `fix/registration-admin-approval`, not automatically on
the live site. Merge that branch into the branch used by your site's deployment.
If using GitHub Pages, check the repository's **Settings → Pages** to see the
publishing branch/workflow. Wait for the deployment to finish. The new site must
include `owner-setup.html`, `owner-setup.js` and the other files in this branch.

## 2. Turn on the two login methods

Open https://console.firebase.google.com and select **cas-silent-auction**.
Choose **Build → Authentication → Sign-in method** (click Get started if shown).
Enable **Email/Password** and save. Then enable **Google**, choose the support
email if prompted, and save. You do not need phone authentication or email-link
login. Email/password is for organizers; Google is for guests.

## 3. Allow your website domain

In **Authentication → Settings → Authorized domains**, ensure the hostname of
your deployed site is listed. For GitHub Pages, add `notasmokinggun.github.io`.
Do not include `https://` or `/silentauction` in this Firebase field.

For Google guest login, also open https://console.cloud.google.com, select the
same project, then **APIs & Services → Credentials**. Open the web OAuth client
whose client ID matches `GOOGLE_CLIENT_ID` in `firebase-init.js`. Under
**Authorized JavaScript origins**, add `https://notasmokinggun.github.io` and save.
Use your actual origin instead if the site is on a different/custom domain.
The origin includes `https://` here but never a path such as `/silentauction`.

## 4. Publish the database rules

In Firebase choose **Build → Firestore Database → Rules**. Open `firestore.rules`
from this GitHub branch, click Raw, and copy all its contents. Replace the text
in the Firebase rules editor with it, then click **Publish**.

If Firestore has not been created, click Create database, choose the no-cost
Standard database option, select a location, start in production mode, then
publish the supplied rules. Keep existing items; do not delete your database.

## 5. Make a one-time setup code

In **Firestore Database → Data**:

1. Click **Start collection**.
2. Collection ID: type exactly `setupKeys`, then click Next.
3. Beside Document ID, click **Auto-ID**.
4. Copy that generated ID somewhere private. That is your one-time setup code.
5. Add a field named `enabled`.
6. Set its type to **boolean** and value to **true**.
7. Click **Save**.

No email or password is entered into this document. Do not share the code: it
lets its holder choose the first owner. It becomes unusable after successful setup.

## 6. Choose your owner email on the website

Open your published site's admin login page and click **First-time owner setup**.
Alternatively open `owner-setup.html` in the same folder as `admin.html`.

1. Type the email you want as owner and choose a password.
2. Click **Create my account**. If you already have that account, use **I already
   have an account** instead.
3. Paste the setup code from step 5 above.
4. Click **Make this my owner account**.

No email is sent at any point in this flow. Wait for "Owner saved". Your
email/account is now stored in Firebase, the setup code is disabled, and
owner setup is locked. You do not manually copy a UID.

## 7. Add other admins when you want

Open **Admin → Settings → Manage admin access**, enter their email and click
**Add admin**. This only adds the email to the allowlist — nothing is
emailed to them. They then go to the admin login page, enter that exact
email, choose their own password, and tap **Create Password**. The app
checks the allowlist first: if the email hasn't been approved, no account
is created at all. If they already have an account, they just sign in
normally with their email and password.

Only your owner account can approve or remove admins. Other admins can manage
the auction, but cannot approve anybody else. There is no self-service
"forgot password" — since no email is ever sent, a locked-out admin needs
the owner (or you) to delete their account in the Firebase console
(Authentication tab), after which they can run **Create Password** again
with the same email. Guests continue using Google, with no new password or
OTP required by this site.

## If something fails

- Google says origin not allowed: recheck both domain settings in step 3 and the
  configured OAuth client ID.
- Permission denied: ensure you published the latest rules and selected the
  correct Firebase project. Email verification is never required by this app.
- Setup cannot finish: check the setup ID is exact and `enabled` is a boolean
  true. If an owner was already saved, setup is intentionally locked; use that
  owner's account instead.
- "This email hasn't been approved": the owner needs to add the exact email
  first on the Admin Access page before an account can be created for it.
- Setup page missing: the live site is probably still using an older branch/build.
