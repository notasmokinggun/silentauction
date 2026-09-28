const { before, after, test } = require('node:test');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, setDoc, deleteDoc, serverTimestamp, writeBatch } = require('firebase/firestore');
let env;
const account = (uid, email, verified = true) => env.authenticatedContext(uid, {
  email, email_verified: verified, firebase: { sign_in_provider: 'google.com' },
}).firestore();
const approval = (email, uid, role = 'admin') => ({ email, approved: true, role, updatedBy: uid, updatedAt: serverTimestamp() });
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-silentauction', firestore: {
    rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080,
  } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'settings/owner'), { uid: 'owner', email: 'owner@example.com' });
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
test('unverified emails and non-Google providers are never admin', async () => {
  const unverified = account('owner-unverified', 'owner@example.com', false);
  await assertFails(getDocs(collection(unverified, 'adminEmails')));
  await assertFails(getDoc(doc(unverified, 'users/guest')));
  const pw = env.authenticatedContext('owner-pw', {
    email: 'owner@example.com', email_verified: true, firebase: { sign_in_provider: 'password' },
  }).firestore();
  await assertFails(getDocs(collection(pw, 'adminEmails')));
  await assertFails(setDoc(doc(pw, 'items/new'), { title: 'Nope' }));
});
test('an authenticated but unapproved email is still blocked from everything', async () => {
  const db = account('stranger', 'stranger@example.com');
  await assertFails(getDocs(collection(db, 'adminEmails')));
  await assertFails(getDoc(doc(db, 'users/guest')));
  await assertFails(setDoc(doc(db, 'items/new'), { title: 'Unauthorized' }));
});
test('adminEmails is not publicly gettable; a user may read only their own row', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, 'adminEmails/admin@example.com')));
  await assertFails(getDocs(collection(anon, 'adminEmails')));
  const stranger = account('stranger', 'stranger@example.com');
  await assertFails(getDoc(doc(stranger, 'adminEmails/admin@example.com')));
  await assertSucceeds(getDoc(doc(stranger, 'adminEmails/stranger@example.com')));
  await assertSucceeds(getDoc(doc(account('admin', 'admin@example.com'), 'adminEmails/owner@example.com')));
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
test('legacy admins/{email} collection grants no access even if pre-approved there', async () => {
  const db = account('guest', 'guest@example.com');
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'admins/guest'), { approved: true }));
  await assertFails(getDoc(doc(db, 'users/other')));
  await assertFails(setDoc(doc(db, 'items/legacy'), { title: 'Unauthorized' }));
});

test('approved ordinary admins can manage lots but cannot approve, list or revoke admins', async () => {
  const db = account('admin', 'admin@example.com');
  await assertSucceeds(setDoc(doc(db, 'items/allowed'), { title: 'Allowed lot' }));
  await assertFails(getDocs(collection(db, 'adminEmails')));
  await assertFails(setDoc(doc(db, 'adminEmails/escalated@example.com'), approval('escalated@example.com', 'admin')));
  await assertFails(deleteDoc(doc(db, 'adminEmails/new@example.com')));
  await assertFails(setDoc(doc(db, 'settings/owner'), { uid: 'admin', email: 'admin@example.com' }));
});
test('a different UID cannot claim owner powers merely by carrying the owner email', async () => {
  const db = account('different-uid', 'owner@example.com');
  await assertFails(setDoc(doc(db, 'adminEmails/imposter@example.com'), approval('imposter@example.com', 'different-uid')));
});
test('first-owner setup requires the private code (not email verification), consumes it atomically, and locks permanently', async () => {
  await env.clearFirestore();
  const key = 'TestRandomSetupCode123456789';
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'setupKeys/' + key), { enabled: true }));
  function claim(db, uid, email, code, consume = true) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'settings/owner'), { uid, email, setupKey: code, createdAt: serverTimestamp() });
    batch.set(doc(db, 'adminEmails/' + email), approval(email, uid, 'owner'));
    if (consume) batch.set(doc(db, 'setupKeys/' + code), { enabled: false });
    return batch.commit();
  }
  const db = account('first', 'first@example.com');
  await assertFails(getDoc(doc(db, 'setupKeys/' + key)));
  await assertFails(getDocs(collection(db, 'setupKeys')));
  await assertFails(setDoc(doc(db, 'setupKeys/AttackerGeneratedKey12345'), { enabled: true }));
  await assertFails(claim(db, 'first', 'first@example.com', 'WrongSetupCode1234567890'));
  await assertFails(claim(db, 'first', 'someoneelse@example.com', key));
  await assertFails(claim(db, 'first', 'first@example.com', key, false));
  // Claiming ownership needs a verified Google email.
  await assertFails(claim(account('first', 'first@example.com', false), 'first', 'first@example.com', key));
  await assertSucceeds(claim(db, 'first', 'first@example.com', key));
  await assertSucceeds(setDoc(doc(db, 'adminEmails/helper@example.com'), approval('helper@example.com', 'first')));
  await env.withSecurityRulesDisabled(async context => {
    const consumed = await getDoc(doc(context.firestore(), 'setupKeys/' + key));
    require('node:assert/strict').equal(consumed.data().enabled, false);
    await setDoc(doc(context.firestore(), 'setupKeys/AnotherSetupCode123456789'), { enabled: true });
  });
  await assertFails(claim(account('second', 'second@example.com'), 'second', 'second@example.com', 'AnotherSetupCode123456789'));
  await assertFails(deleteDoc(doc(db, 'settings/owner')));
  await assertFails(deleteDoc(doc(db, 'adminEmails/first@example.com')));
});

// ── Bidding rules (S2–S5). Written without an emulator run available:
// run `npm run test:rules` before publishing the rules. ──
const bidder = (uid, email) => env.authenticatedContext(uid, {
  email, email_verified: true, firebase: { sign_in_provider: 'google.com' },
}).firestore();
const seedLot = async (id, extra = {}) => env.withSecurityRulesDisabled(async ctx => {
  await setDoc(doc(ctx.firestore(), 'items/' + id), {
    title: 'Lot', active: true, currentBid: 100, increment: 10, bidCount: 0,
    currentBidderName: '', currentBidderUid: '', ...extra,
  });
});
const placeBid = (db, lotId, uid, email, amount, bidCount = 0, over = {}) => {
  const b = writeBatch(db);
  b.update(doc(db, 'items/' + lotId), { currentBid: amount, currentBidderName: 'A', currentBidderUid: uid, bidCount: bidCount + 1 });
  b.set(doc(collection(db, 'items/' + lotId + '/bids')), {
    name: 'A', phone: '9876543210', email, amount, uid, isGoogle: true, deviceId: 'dev_x',
    timestamp: serverTimestamp(), ...over,
  });
  b.set(doc(db, 'bidLimits/' + uid), { lastBidAt: serverTimestamp() });
  return b.commit();
};
test('bids are admin-read-only', async () => {
  await seedLot('r1');
  const g = bidder('g1', 'g1@example.com');
  await assertSucceeds(placeBid(g, 'r1', 'g1', 'g1@example.com', 110));
  await assertFails(getDocs(collection(g, 'items/r1/bids')));
  await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'items/r1/bids')));
  await assertSucceeds(getDocs(collection(account('admin', 'admin@example.com'), 'items/r1/bids')));
});
test('a bid doc without the matching item update is rejected', async () => {
  await seedLot('b1');
  const g = bidder('g2', 'g2@example.com');
  const b = writeBatch(g);
  b.set(doc(collection(g, 'items/b1/bids')), { name: 'A', phone: '9876543210', email: 'g2@example.com', amount: 5000, uid: 'g2', isGoogle: true, deviceId: 'd', timestamp: serverTimestamp() });
  b.set(doc(g, 'bidLimits/g2'), { lastBidAt: serverTimestamp() });
  await assertFails(b.commit());
});
test('forged email or extra fields on a bid are rejected', async () => {
  await seedLot('f1');
  const g = bidder('g3', 'g3@example.com');
  await assertFails(placeBid(g, 'f1', 'g3', 'someone-else@example.com', 110));
  await assertFails(placeBid(g, 'f1', 'g3', 'g3@example.com', 110, 0, { extra: 'x' }));
  await assertFails(placeBid(g, 'f1', 'g3', 'g3@example.com', 110.5));
});
test('a second bid within 3 seconds is rejected', async () => {
  await seedLot('c1');
  const g = bidder('g4', 'g4@example.com');
  await assertSucceeds(placeBid(g, 'c1', 'g4', 'g4@example.com', 110));
  await assertFails(placeBid(g, 'c1', 'g4', 'g4@example.com', 120, 1));
});
test('bids after endsAt are rejected', async () => {
  await seedLot('e1', { endsAt: new Date(Date.now() - 60000) });
  await assertFails(placeBid(bidder('g5', 'g5@example.com'), 'e1', 'g5', 'g5@example.com', 110));
});
test('nobody can write another uid\'s bidLimits, and bidBlocks are closed', async () => {
  const g = bidder('g6', 'g6@example.com');
  await assertFails(setDoc(doc(g, 'bidLimits/victim'), { lastBidAt: serverTimestamp() }));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'bidLimits/g6'), { lastBidAt: serverTimestamp() }));
  await assertFails(setDoc(doc(g, 'bidLimits/g6'), { lastBidAt: new Date(Date.now() + 86400000) }));
  await assertFails(setDoc(doc(g, 'bidBlocks/dev_x'), { blockedUntil: new Date(Date.now() + 600000) }));
});
