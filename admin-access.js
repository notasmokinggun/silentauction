const accessStatus = document.getElementById('status');
const manager = document.getElementById('manager');
let stopAccess = null;
let accessVersion = 0;
async function refreshAdmins() {
  const version = accessVersion;
  try {
    const result = await db.collection('adminEmails').get();
    if (version !== accessVersion) return;
    const list = document.getElementById('admins');
    list.replaceChildren();
    result.docs.forEach(doc => {
      const admin = { ...doc.data(), email: doc.id, self: doc.id === adminEmail(auth.currentUser) };
      const row = document.createElement('li');
      const label = document.createElement('div');
      label.className = 'email';
      label.textContent = admin.email + (admin.self ? ' (you)' : '') + (admin.role === 'owner' ? ' · Owner' : '');
      row.appendChild(label);
      if (!admin.self && admin.role !== 'owner') {
        const remove = document.createElement('button');
        remove.textContent = 'Remove admin';
        remove.onclick = async () => {
          if (!confirm('Remove admin access for ' + admin.email + '?')) return;
          remove.disabled = true;
          try {
            await db.collection('adminEmails').doc(admin.email).delete();
            accessStatus.textContent = 'Admin access removed for ' + admin.email + '.';
            await refreshAdmins();
          } catch (err) { accessStatus.textContent = err.message; remove.disabled = false; }
        };
        row.appendChild(remove);
      }
      list.appendChild(row);
    });
    manager.hidden = false;
  } catch (err) {
    if (version !== accessVersion) return;
    manager.hidden = true;
    accessStatus.textContent = 'Could not load admin access: ' + err.message;
  }
}
auth.onAuthStateChanged(user => {
  accessVersion++;
  if (stopAccess) stopAccess();
  manager.hidden = true;
  document.getElementById('admins').replaceChildren();
  document.getElementById('signout').hidden = !user;
  document.getElementById('login').hidden = !!user && user.emailVerified;
  if (!user || !user.emailVerified) { accessStatus.textContent = 'Sign in with a verified, approved admin email to continue.'; return; }
  stopAccess = adminApprovalRef(user).onSnapshot(doc => {
    accessVersion++;
    manager.hidden = true;
    if (!doc.exists || doc.data().approved !== true) {
      document.getElementById('admins').replaceChildren();
      accessStatus.textContent = 'This account does not have admin access.';
      return;
    }
    accessStatus.textContent = 'Signed in as ' + user.email + '.';
    refreshAdmins();
  }, err => { accessVersion++; manager.hidden = true; accessStatus.textContent = err.message; });
});
document.getElementById('add-admin').onsubmit = async event => {
  event.preventDefault();
  const button = document.getElementById('add');
  button.disabled = true;
  accessStatus.textContent = 'Adding admin…';
  try {
    const email = document.getElementById('email').value.trim().toLowerCase();
    if (email.includes('/')) throw new Error('Enter a valid email address.');
    const ref = db.collection('adminEmails').doc(email);
    await db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (existing.exists && existing.data().approved === true) return;
      tx.set(ref, { email, approved: true, role: 'admin', updatedBy: auth.currentUser.uid,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    accessStatus.textContent = 'Admin email approved: ' + email + '. They can create their account and verify their email on the admin login page.';
    event.target.reset();
    await refreshAdmins();
  } catch (err) { accessStatus.textContent = 'Could not add admin: ' + err.message; }
  finally { button.disabled = false; }
};
document.getElementById('refresh').onclick = refreshAdmins;
document.getElementById('signout').onclick = () => auth.signOut().catch(err => { accessStatus.textContent = err.message; });
