const setupStatus = document.getElementById('status');
function displaySetupUser(user) {
  document.getElementById('account').hidden = !!user && !user.isAnonymous;
  document.getElementById('identity-panel').hidden = !user || user.isAnonymous;
  document.getElementById('claim').hidden = !user || user.isAnonymous;
  document.getElementById('done').hidden = true;
  document.getElementById('identity').textContent = user ? 'Owner email: ' + (user.email || '') : '';
  setupStatus.textContent = user && !user.isAnonymous
    ? 'Enter your one-time setup code below.'
    : 'Create your account, or sign in if you already have one.';
  if (user && !user.isAnonymous) {
    db.collection('settings').doc('owner').get().then(doc => {
      if (!auth.currentUser || auth.currentUser.uid !== user.uid || !doc.exists || doc.data().uid !== user.uid) return;
      document.getElementById('claim').hidden = true;
      document.getElementById('done').hidden = false;
      setupStatus.textContent = 'Your owner account is already saved. Owner setup is locked.';
    }).catch(err => {
      // Non-owners cannot read this private record. They may still attempt
      // initial setup with the private code; the write rules decide access.
      if (err.code !== 'permission-denied') setupStatus.textContent = 'Could not check saved setup: ' + err.message;
    });
  }
}
auth.onAuthStateChanged(u => { Promise.resolve(displaySetupUser(u)).finally(() => { if (window.hidePageLoader) window.hidePageLoader(); }); });
async function accountAction(create) {
  const form = document.getElementById('account');
  if (!form.reportValidity()) return;
  form.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try {
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    const email = document.getElementById('email').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    create ? await auth.createUserWithEmailAndPassword(email, password) : await auth.signInWithEmailAndPassword(email, password);
    document.getElementById('password').value = '';
  } catch (err) { setupStatus.textContent = err.message; }
  finally { form.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
}
document.getElementById('account').onsubmit = event => { event.preventDefault(); accountAction(true); };
document.getElementById('signin').onclick = () => accountAction(false);
document.getElementById('signout').onclick = () => auth.signOut().catch(err => { setupStatus.textContent = err.message; });
document.getElementById('claim').onsubmit = async event => {
  event.preventDefault();
  const button = document.getElementById('claim-button');
  button.disabled = true;
  try {
    const user = auth.currentUser;
    if (!user || !user.email) throw new Error('Sign in with your owner email before claiming ownership.');
    const setupKey = document.getElementById('setup-key').value.trim();
    if (!/^[a-zA-Z0-9_-]{20,128}$/.test(setupKey)) throw new Error('Copy the full setup code from Firebase.');
    await user.getIdToken(true);
    const email = adminEmail(user);
    const timestamp = firebase.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(db.collection('settings').doc('owner'), { uid: user.uid, email, setupKey, createdAt: timestamp });
    batch.set(db.collection('setupKeys').doc(setupKey), { enabled: false });
    batch.set(adminApprovalRef(user), { email, role: 'owner', approved: true, updatedBy: user.uid, updatedAt: timestamp });
    await batch.commit();
    document.getElementById('setup-key').value = '';
    document.getElementById('claim').hidden = true;
    document.getElementById('done').hidden = false;
    setupStatus.textContent = 'Owner saved: ' + email + '. Only your account can approve new admins. This setup is now locked.';
  } catch (err) {
    setupStatus.textContent = err.code === 'permission-denied'
      ? 'Setup could not be completed. Check that the new rules are published and the setup code is enabled. If an owner was already saved, setup is locked.'
      : err.message;
  } finally { button.disabled = false; }
};
