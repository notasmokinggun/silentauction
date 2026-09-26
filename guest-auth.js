// Google Identity Services returns an ID token directly to this page. Firebase
// verifies it and creates the session; no Firebase popup/redirect relay is used.
let bidderProfile = null;
let googleReady = false;
let profileTask = null;
let profileTaskUid = null;
let guestMessage = 'Choose your Google account to continue.';
const guestPersistence = auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
guestPersistence.catch(err => setGuestMessage('Could not remember sign-in: ' + err.message));

function isGoogleGuest(user) {
  return !!user && user.providerData.some(provider => provider.providerId === 'google.com');
}
function setGuestMessage(message) {
  guestMessage = message;
  document.querySelectorAll('[data-guest-status]').forEach(el => { el.textContent = message; });
}
function renderSigninAreas() {
  ['s', 'p'].forEach(prefix => {
    const area = document.getElementById(prefix + '-signin-area');
    if (!area.dataset.ready) {
      area.dataset.ready = 'true';
      area.innerHTML = '<div data-google-button></div><p data-guest-status role="status"></p>' +
        '<div data-guest-details hidden><div class="name-field"><label>Email<input id="' + prefix + '-email" type="email" readonly></label></div>' +
        '<div class="name-field"><label>Phone (optional)<input id="' + prefix + '-phone" type="tel" autocomplete="tel" maxlength="30"></label></div>' +
        '<button class="gbtn" data-save-contact>Save phone number</button> <button class="gbtn" data-guest-signout>Sign out</button></div>' +
        '<button class="gbtn" data-retry-profile hidden>Retry saving profile</button>';
      area.querySelector('[data-save-contact]').onclick = async event => {
        event.target.disabled = true;
        try { await saveRegistration(prefix); setGuestMessage('Contact details saved.'); }
        catch (err) { setGuestMessage('Could not save contact details: ' + err.message); }
        finally { event.target.disabled = false; }
      };
      area.querySelector('[data-guest-signout]').onclick = () => {
        auth.signOut().catch(err => setGuestMessage('Could not sign out: ' + err.message));
      };
      area.querySelector('[data-retry-profile]').onclick = () => syncGuestProfile(auth.currentUser).catch(() => {});
    }
    const signedIn = isGoogleGuest(auth.currentUser) && !!bidderProfile;
    area.querySelector('[data-guest-details]').hidden = !signedIn;
    area.querySelector('[data-retry-profile]').hidden = !isGoogleGuest(auth.currentUser) || !!bidderProfile || !!profileTask;
    const button = area.querySelector('[data-google-button]');
    button.hidden = signedIn;
    if (googleReady && !button.dataset.rendered) {
      google.accounts.id.renderButton(button, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill' });
      button.dataset.rendered = 'true';
    }
    document.getElementById(prefix + '-name').readOnly = true;
    area.querySelector('[data-guest-status]').textContent = guestMessage;
  });
}
function fillGuestFields(profile) {
  ['s', 'p'].forEach(prefix => {
    ['name', 'email', 'phone'].forEach(key => {
      document.getElementById(prefix + '-' + key).value = profile ? profile[key] || '' : '';
    });
  });
}
async function syncGuestProfile(user) {
  if (!isGoogleGuest(user)) return;
  if (profileTask && profileTaskUid === user.uid) return profileTask;
  profileTaskUid = user.uid;
  setGuestMessage('Saving your Google profile…');
  const task = (async () => {
    const ref = db.collection('users').doc(user.uid);
    const previous = await ref.get();
    const name = (user.displayName || '').trim().slice(0, 79);
    if (!name || !user.email) throw new Error('Your Google account did not provide a name and email. Try another account.');
    const profile = { name, email: user.email, phone: previous.exists ? previous.data().phone || '' : '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    await ref.set(profile);
    if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
    bidderProfile = profile;
    fillGuestFields(profile);
    setGuestMessage('Signed in as ' + name + '. Your registration is saved.');
  })();
  profileTask = task;
  try { await task; }
  catch (err) {
    if (auth.currentUser && auth.currentUser.uid === user.uid) {
      bidderProfile = null;
      setGuestMessage('Could not save your Google profile: ' + err.message);
    }
    throw err;
  } finally {
    if (profileTask === task) { profileTask = null; profileTaskUid = null; }
    renderSigninAreas();
  }
}
async function handleGoogleCredential(response) {
  try {
    setGuestMessage('Signing in…');
    if (!response.credential) throw new Error('Google did not return a sign-in credential. Please try again.');
    await guestPersistence;
    const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
    const result = await auth.signInWithCredential(credential);
    await syncGuestProfile(result.user);
  } catch (err) { setGuestMessage('Sign-in could not finish: ' + err.message); }
}
async function saveRegistration(prefix) {
  const user = auth.currentUser;
  if (!isGoogleGuest(user)) throw new Error('Continue with Google before confirming your bid.');
  if (profileTask) await profileTask;
  if (!bidderProfile) await syncGuestProfile(user);
  if (!bidderProfile || auth.currentUser !== user) throw new Error('Please sign in again.');
  const phone = document.getElementById(prefix + '-phone').value.trim();
  if (phone.length > 30) throw new Error('Phone number is too long.');
  const profile = { ...bidderProfile, phone, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  await db.collection('users').doc(user.uid).set(profile);
  bidderProfile = profile;
  fillGuestFields(profile);
  return user;
}
renderSigninAreas();
auth.onAuthStateChanged(user => {
  bidderProfile = null;
  fillGuestFields(null);
  setGuestMessage(isGoogleGuest(user) ? 'Saving your Google profile…' : 'Choose your Google account to continue.');
  renderSigninAreas();
  if (isGoogleGuest(user)) syncGuestProfile(user).catch(() => {});
});
const googleScript = document.createElement('script');
googleScript.src = 'https://accounts.google.com/gsi/client';
googleScript.async = true;
const googleLoadTimeout = setTimeout(() => {
  if (!googleReady) setGuestMessage('Google sign-in is taking too long to load. Check your connection and reload.');
}, 15000);
googleScript.onload = () => {
  clearTimeout(googleLoadTimeout);
  try {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential, ux_mode: 'popup', auto_select: false });
    googleReady = true;
    renderSigninAreas();
  } catch (err) { setGuestMessage('Could not load Google sign-in: ' + err.message); }
};
googleScript.onerror = () => {
  clearTimeout(googleLoadTimeout);
  setGuestMessage('Could not load Google sign-in. Check your connection and reload.');
};
document.head.appendChild(googleScript);
