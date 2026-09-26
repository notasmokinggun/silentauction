const { before, after, test } = require('node:test');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, setDoc, deleteDoc, serverTimestamp } = require('firebase/firestore');
let env;
const account = (uid, email, verified = true) => env.authenticatedContext(uid, {
  email, email_verified: verified, firebase: { sign_in_provider: 'password' },
}).firestore();
const approval = (email, uid, role = 'admin') => ({ email, approved: true, role, updatedBy: uid, updatedAt: serverTimestamp() });
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-silentauction', firestore: {
    rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080,
  } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'adminEmails/owner@example.com'), { approved: true, role: 'owner', email: 'owner@example.com' });
    await setDoc(doc(context.firestore(), 'adminEmails/admin@example.com'), { approved: true, role: 'admin', email: 'admin@example.com' });
    await setDoc(doc(context.firestore(), 'users/guest'), { email: 'guest@example.com', name: 'Guest', phone: '' });
  });
});
after(async () => { if (env) await env.cleanup(); });
test('anonymous and ordinary guests cannot read the list or approve themselves', async () => {
  for (const db of [env.unauthenticatedContext().firestore(), account('guest', 'guest@example.com')]) {
    await assertFails(getDocs(collection(db, 'adminEmails')));
    await assertFails(setDoc(doc(db, 'adminEmails/guest@example.com'), approval('guest@example.com', 'guest')));
  }
});
test('an unverified account cannot claim an approved email', async () => {
  const db = account('unverified', 'owner@example.com', false);
  await assertFails(getDocs(collection(db, 'adminEmails')));
  await assertFails(getDoc(doc(db, 'users/guest')));
  await assertFails(setDoc(doc(db, 'items/new'), { title: 'Unauthorized' }));
});
test('verified approved email permits management; mixed-case tokens normalize', async () => {
  const db = account('owner', 'Owner@Example.com');
  await assertSucceeds(getDocs(collection(db, 'adminEmails')));
  await assertSucceeds(setDoc(doc(db, 'adminEmails/new@example.com'), approval('new@example.com', 'owner')));
  await assertSucceeds(getDoc(doc(account('new', 'new@example.com'), 'users/guest')));
});
test('server rules forbid creating owners, changing owners or self-removal', async () => {
  const db = account('admin', 'admin@example.com');
  await assertFails(setDoc(doc(db, 'adminEmails/fakeowner@example.com'), approval('fakeowner@example.com', 'admin', 'owner')));
  await assertFails(setDoc(doc(db, 'adminEmails/owner@example.com'), approval('owner@example.com', 'admin')));
  await assertFails(deleteDoc(doc(db, 'adminEmails/owner@example.com')));
  await assertFails(deleteDoc(doc(db, 'adminEmails/admin@example.com')));
});
test('rejects forged audit identity and malformed approval fields', async () => {
  const db = account('owner', 'owner@example.com');
  await assertFails(setDoc(doc(db, 'adminEmails/forged@example.com'), approval('forged@example.com', 'someone-else')));
  await assertFails(setDoc(doc(db, 'adminEmails/uppercase@Example.com'), approval('uppercase@Example.com', 'owner')));
  await assertFails(setDoc(doc(db, 'adminEmails/extra@example.com'), { ...approval('extra@example.com', 'owner'), password: 'no' }));
});
test('revocation takes effect for an existing authenticated session', async () => {
  const owner = account('owner', 'owner@example.com');
  const removed = account('removed', 'removed@example.com');
  await assertSucceeds(setDoc(doc(owner, 'adminEmails/removed@example.com'), approval('removed@example.com', 'owner')));
  await assertSucceeds(getDoc(doc(removed, 'users/guest')));
  await assertSucceeds(deleteDoc(doc(owner, 'adminEmails/removed@example.com')));
  await assertFails(getDoc(doc(removed, 'users/guest')));
  await assertFails(setDoc(doc(removed, 'adminEmails/removed@example.com'), approval('removed@example.com', 'removed')));
});
test('verified users can check only their own approval; legacy approvals grant no access', async () => {
  const db = account('guest', 'guest@example.com');
  await assertSucceeds(getDoc(doc(db, 'adminEmails/guest@example.com')));
  await assertFails(getDoc(doc(db, 'adminEmails/admin@example.com')));
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'admins/guest'), { approved: true }));
  await assertFails(getDoc(doc(db, 'users/other')));
  await assertFails(setDoc(doc(db, 'items/legacy'), { title: 'Unauthorized' }));
});
