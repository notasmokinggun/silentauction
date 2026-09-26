const backend = firebase.app().functions('us-central1');
const accessStatus = document.getElementById('status');
const manager = document.getElementById('manager');
let stopAccess = null;
let accessVersion = 0;
async function refreshAdmins() {
  const version = accessVersion;
  try {
    const result = await backend.httpsCallable('listAdmins')();
    if (version !== accessVersion) return;
    const list = document.getElementById('admins');
    list.replaceChildren();
    result.data.admins.forEach(admin => {
      const row = document.createElement('li');
      const label = document.createElement('div');
      label.className = 'email';
      label.textContent = admin.email + (admin.self ? ' (you)' : '');
      row.appendChild(label);
      if (!admin.self) {
        const remove = document.createElement('button');
        remove.textContent = 'Remove admin';
        remove.onclick = async () => {
          if (!confirm('Remove admin access for ' + admin.email + '?')) return;
          remove.disabled = true;
          try {
            await backend.httpsCallable('removeAdmin')({ uid: admin.uid });
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
  document.getElementById('login').hidden = !!user && !user.isAnonymous;
  if (!user || user.isAnonymous) { accessStatus.textContent = 'Sign in as an approved admin to continue.'; return; }
  stopAccess = db.collection('admins').doc(user.uid).onSnapshot(doc => {
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
    const result = await backend.httpsCallable('addAdmin')({ email: document.getElementById('email').value.trim() });
    accessStatus.textContent = 'Admin access granted to ' + result.data.email + '. They can set their password on the admin login page.';
    event.target.reset();
    await refreshAdmins();
  } catch (err) { accessStatus.textContent = 'Could not add admin: ' + err.message; }
  finally { button.disabled = false; }
};
document.getElementById('refresh').onclick = refreshAdmins;
document.getElementById('signout').onclick = () => auth.signOut().catch(err => { accessStatus.textContent = err.message; });
