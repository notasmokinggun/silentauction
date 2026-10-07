const { before, after, test } = require('node:test');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, collectionGroup, query, where, setDoc, deleteDoc, serverTimestamp, writeBatch } = require('firebase/firestore');
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
test('email_verified no longer matters — no verification email is ever sent', async () => {
  // Same approved owner email, but with email_verified: false on the token —
  // this must still work, since nothing in this app can ever set it true.
  const db = account('owner-unverified', 'owner@example.com', false);
  await assertSucceeds(getDocs(collection(db, 'adminEmails')));
  await assertSucceeds(getDoc(doc(db, 'users/guest')));
});
test('an authenticated but unapproved email is still blocked from everything', async () => {
  const db = account('stranger', 'stranger@example.com');
  await assertFails(getDocs(collection(db, 'adminEmails')));
  await assertFails(getDoc(doc(db, 'users/guest')));
  await assertFails(setDoc(doc(db, 'items/new'), { title: 'Unauthorized' }));
});
test('any exact adminEmails doc is publicly gettable (pre-signup allowlist check), but listing stays owner-only', async () => {
  // admin.html must be able to check "is this email approved?" before an
  // Auth account for it even exists — there is no signed-in user yet to
  // compare against, so this single-doc get has to be open to anyone.
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anon, 'adminEmails/admin@example.com')));
  await assertSucceeds(getDoc(doc(anon, 'adminEmails/nobody@example.com'))); // not-found is fine, just not a permission error
  await assertFails(getDocs(collection(anon, 'adminEmails')));
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
  // email_verified: false on the claiming account's token must NOT block
  // this — nothing in the app can ever set that flag true.
  await assertSucceeds(claim(account('first', 'first@example.com', false), 'first', 'first@example.com', key));
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
  const bidRef = doc(collection(db, 'items/' + lotId + '/bids'));
  b.update(doc(db, 'items/' + lotId), { currentBid: amount, currentBidderName: 'A', currentBidderUid: uid, bidCount: bidCount + 1,
    prevBid: 100, prevBidderName: '', prevBidderUid: null, prevKnown: true, lastBidId: bidRef.id });
  b.set(bidRef, {
    name: 'A', phone: '9876543210', email, amount, uid, isGoogle: true, deviceId: 'dev_x',
    childName: 'Kid', classSection: '8-A', admissionNumber: '', timestamp: serverTimestamp(), ...over,
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
  b.set(doc(collection(g, 'items/b1/bids')), { name: 'A', phone: '9876543210', childName: 'Kid', childGrade: '8', email: 'g2@example.com', amount: 120, uid: 'g2', isGoogle: true, deviceId: 'd', timestamp: serverTimestamp() });
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

// ── 5x review hold ──
const holdFields = (uid, email, amount, over = {}) => ({
  name: 'A', phone: '9876543210', email, amount, uid, isGoogle: true, deviceId: 'dev_x',
  childName: 'Kid', classSection: '8-A', admissionNumber: '', timestamp: serverTimestamp(), status: 'pending', ...over,
});
const placeHold = (db, lotId, uid, email, amount, over = {}, id = 'hold_' + uid) => {
  const b = writeBatch(db);
  b.set(doc(db, 'items/' + lotId + '/bids/' + id), holdFields(uid, email, amount, over));
  b.set(doc(db, 'bidLimits/' + uid), { lastBidAt: serverTimestamp() });
  return b.commit();
};
test('a bid 5x or more above the price can only be placed as a pending hold', async () => {
  await seedLot('h1'); // currentBid 100 -> threshold 500
  const g = bidder('h1u', 'h1u@example.com');
  await assertFails(placeBid(g, 'h1', 'h1u', 'h1u@example.com', 500)); // straight onto the lot
  await assertSucceeds(placeHold(g, 'h1', 'h1u', 'h1u@example.com', 500));
});
test('a hold below 5x, a wrong id, a non-pending status or a hold on a closed lot is rejected', async () => {
  await seedLot('h2');
  await seedLot('h2c', { active: false });
  const g = bidder('h2u', 'h2u@example.com');
  await assertFails(placeHold(g, 'h2', 'h2u', 'h2u@example.com', 499));
  await assertFails(placeHold(g, 'h2', 'h2u', 'h2u@example.com', 900, {}, 'hold_someoneelse'));
  await assertFails(placeHold(g, 'h2', 'h2u', 'h2u@example.com', 900, { status: 'confirmed' }));
  await assertFails(placeHold(g, 'h2c', 'h2u', 'h2u@example.com', 900));
});
test('a hold does not change the lot, and a bidder cannot confirm their own hold', async () => {
  await seedLot('h3');
  const g = bidder('h3u', 'h3u@example.com');
  await assertSucceeds(placeHold(g, 'h3', 'h3u', 'h3u@example.com', 900));
  await assertFails(setDoc(doc(g, 'items/h3/bids/hold_h3u'), holdFields('h3u', 'h3u@example.com', 900, { status: 'confirmed' })));
  await assertFails(setDoc(doc(g, 'items/h3'), { currentBid: 900, currentBidderName: 'A', currentBidderUid: 'h3u', bidCount: 1 }, { merge: true }));
  await assertSucceeds(setDoc(doc(account('admin', 'admin@example.com'), 'items/h3/bids/hold_h3u'), { status: 'confirmed' }, { merge: true }));
});
test('a bidder can withdraw a pending hold but not delete a confirmed one', async () => {
  await seedLot('h4');
  const g = bidder('h4u', 'h4u@example.com');
  await assertSucceeds(placeHold(g, 'h4', 'h4u', 'h4u@example.com', 900));
  await assertSucceeds(deleteDoc(doc(g, 'items/h4/bids/hold_h4u')));
  await assertSucceeds(placeHold(g, 'h4', 'h4u', 'h4u@example.com', 900));
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'items/h4/bids/hold_h4u'), { status: 'confirmed', uid: 'h4u' }, { merge: true });
  });
  await assertFails(deleteDoc(doc(g, 'items/h4/bids/hold_h4u')));
  await assertFails(deleteDoc(doc(bidder('other', 'other@example.com'), 'items/h4/bids/hold_h4u')));
});
test('a bidder can list only their own bids across lots (My Bids)', async () => {
  await seedLot('m1');
  const a = bidder('ma', 'ma@example.com');
  await assertSucceeds(placeBid(a, 'm1', 'ma', 'ma@example.com', 110));
  await assertSucceeds(getDocs(query(collectionGroup(a, 'bids'), where('uid', '==', 'ma'))));
  await assertFails(getDocs(query(collectionGroup(a, 'bids'), where('uid', '==', 'someone-else'))));
  await assertFails(getDocs(collectionGroup(a, 'bids')));
});

// ── Full-size photos (itemImages) ──
test('itemImages: anyone can get one by id, nobody can list, only admins write', async () => {
  const admin = account('admin', 'admin@example.com');
  await assertSucceeds(setDoc(doc(admin, 'itemImages/p1'), { url: 'data:image/jpeg;base64,AAAA' }));
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anon, 'itemImages/p1')));
  await assertFails(getDocs(collection(anon, 'itemImages')));
  await assertFails(setDoc(doc(bidder('pg', 'pg@example.com'), 'itemImages/p1'), { url: 'x' }));
  await assertSucceeds(deleteDoc(doc(admin, 'itemImages/p1')));
});

// ── Child's name and grade ──
test('a bid needs a child name and a class-section or a 4-digit admission number', async () => {
  await seedLot('k1');
  const g = bidder('k1u', 'k1u@example.com');
  await assertFails(placeBid(g, 'k1', 'k1u', 'k1u@example.com', 110, 0, { classSection: '10B' }));
  await assertFails(placeBid(g, 'k1', 'k1u', 'k1u@example.com', 110, 0, { classSection: '', admissionNumber: '' }));
  await assertFails(placeBid(g, 'k1', 'k1u', 'k1u@example.com', 110, 0, { childName: '' }));
  await assertSucceeds(placeBid(g, 'k1', 'k1u', 'k1u@example.com', 110, 0, { classSection: '', admissionNumber: '1234' }));
});

// ── Email-only (anonymous) guests. Not run against the emulator yet: run
// `npm run test:rules` before publishing the rules. ──
const guest = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const guestFields = (uid, over = {}) => ({
  name: 'A', phone: '9876543210', email: 'a@example.com', amount: 110, uid, isGoogle: false, deviceId: 'dev_guest',
  childName: 'Kid', classSection: '8-A', admissionNumber: '', timestamp: serverTimestamp(), ...over,
});
const guestBid = (db, lotId, uid, over = {}) => {
  const b = writeBatch(db);
  const bidRef = doc(collection(db, 'items/' + lotId + '/bids'));
  b.update(doc(db, 'items/' + lotId), { currentBid: 110, currentBidderName: 'A', currentBidderUid: uid, bidCount: 1,
    prevBid: 100, prevBidderName: '', prevBidderUid: null, prevKnown: true, lastBidId: bidRef.id });
  b.set(bidRef, guestFields(uid, over));
  b.set(doc(db, 'bidLimits/' + uid), { lastBidAt: serverTimestamp() });
  return b.commit();
};
test('an email-only guest can bid with any well-formed email, flagged isGoogle:false', async () => {
  await seedLot('guestlot1');
  await assertSucceeds(guestBid(guest('guestA'), 'guestlot1', 'guestA'));
});
test('a guest bid with a malformed email or isGoogle:true is rejected', async () => {
  await seedLot('guestlot2');
  await assertFails(guestBid(guest('guestB'), 'guestlot2', 'guestB', { email: 'not-an-email' }));
  await assertFails(guestBid(guest('guestC'), 'guestlot2', 'guestC', { isGoogle: true }));
});
test('a device ban blocks email-only guests on that device, but the ban must be well-formed', async () => {
  await seedLot('guestlot3');
  const g = guest('guestD');
  await assertSucceeds(setDoc(doc(g, 'bidBlocks/dev_guest'), { bannedUntil: new Date(Date.now() + 300000) }));
  await assertFails(guestBid(g, 'guestlot3', 'guestD'));
  await assertFails(setDoc(doc(g, 'bidBlocks/dev_other'), { bannedUntil: new Date(Date.now() + 86400000) }));
});
test('unauthenticated visitors still cannot bid or touch bidBlocks', async () => {
  const u = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(u, 'bidBlocks/dev_x'), { bannedUntil: new Date(Date.now() + 300000) }));
});

// ── 1-minute undo of the leading bid. Not run against the emulator yet:
// run `npm run test:rules` before publishing the rules. ──
test('the leader can undo their bid within 60s: lot rolls back and the bid is deleted', async () => {
  await seedLot('undo1');
  const g = bidder('u1', 'u1@example.com');
  const b = writeBatch(g);
  const bidRef = doc(collection(g, 'items/undo1/bids'));
  b.update(doc(g, 'items/undo1'), { currentBid: 110, currentBidderName: 'A', currentBidderUid: 'u1', bidCount: 1,
    prevBid: 100, prevBidderName: '', prevBidderUid: null, prevKnown: true, lastBidId: bidRef.id });
  b.set(bidRef, { name: 'A', phone: '9876543210', email: 'u1@example.com', amount: 110, uid: 'u1', isGoogle: true, deviceId: 'dev_u',
    childName: 'Kid', classSection: '8-A', admissionNumber: '', timestamp: serverTimestamp() });
  b.set(doc(g, 'bidLimits/u1'), { lastBidAt: serverTimestamp() });
  await assertSucceeds(b.commit());
  const u = writeBatch(g);
  u.update(doc(g, 'items/undo1'), { currentBid: 100, currentBidderName: '', currentBidderUid: null, bidCount: 0, prevKnown: false });
  u.delete(bidRef);
  await assertSucceeds(u.commit());
});
test('undo is refused for someone who is not the leader, or without deleting the bid', async () => {
  await seedLot('undo2', { currentBid: 110, currentBidderUid: 'someone', currentBidderName: 'S', bidCount: 1,
    prevBid: 100, prevBidderName: '', prevBidderUid: null, prevKnown: true, lastBidId: 'nope' });
  const g = bidder('u2', 'u2@example.com');
  await assertFails(setDoc(doc(g, 'items/undo2'), { currentBid: 100, currentBidderName: '', currentBidderUid: null, bidCount: 0, prevKnown: false }, { merge: true }));
});

// ── Announce-my-name choice on a bid (optional bool; older pages omit it). Not run against the emulator yet:
// run `npm run test:rules` before publishing the rules. ──
const consentBid = (lot, uid, extra) => {
  const g = bidder(uid, uid + '@example.com');
  const b = writeBatch(g);
  const bidRef = doc(collection(g, 'items/' + lot + '/bids'));
  b.update(doc(g, 'items/' + lot), { currentBid: 110, currentBidderName: 'A', currentBidderUid: uid, bidCount: 1,
    prevBid: 100, prevBidderName: '', prevBidderUid: null, prevKnown: true, lastBidId: bidRef.id });
  b.set(bidRef, { name: 'A', phone: '9876543210', email: uid + '@example.com', amount: 110, uid, isGoogle: true, deviceId: 'dev_c',
    childName: 'Kid', classSection: '8-A', admissionNumber: '', timestamp: serverTimestamp(), ...extra });
  b.set(doc(g, 'bidLimits/' + uid), { lastBidAt: serverTimestamp() });
  return b.commit();
};
test('a bid may say announceName true or false, or omit it (older pages)', async () => {
  await seedLot('cons1'); await assertSucceeds(consentBid('cons1', 'c1', { announceName: true }));
  await seedLot('cons2'); await assertSucceeds(consentBid('cons2', 'c2', { announceName: false }));
  await seedLot('cons3'); await assertSucceeds(consentBid('cons3', 'c3', {}));
});
test('announceName must be a real boolean', async () => {
  await seedLot('cons4'); await assertFails(consentBid('cons4', 'c4', { announceName: 'yes' }));
});

// ── Hardening added with the legal/security pass. Not run against the emulator
// (it can't be downloaded in the sandbox this was written in): run
// `npm run test:rules` before publishing the rules. ──
test('raising a lot without creating a matching bid doc is rejected (no bypass of phone/cooldown/ban)', async () => {
  await seedLot('h1');
  const g = bidder('h1u', 'h1u@example.com');
  // an unrelated, already-existing bid doc to point lastBidId at
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'items/h1/bids/old'), { uid: 'x', amount: 110, name: 'A' }); });
  await assertFails(updateDocViaBatch(g, 'items/h1', { currentBid: 110, currentBidderName: 'A', currentBidderUid: 'h1u', bidCount: 1,
    prevBid: 100, prevBidderName: '', prevBidderUid: null, prevKnown: true, lastBidId: 'old' }));
  await assertSucceeds(placeBid(g, 'h1', 'h1u', 'h1u@example.com', 110));
});
test('the lot name and amount must match the bid doc that raised it', async () => {
  await seedLot('h2');
  const g = bidder('h2u', 'h2u@example.com');
  await assertFails(placeBid(g, 'h2', 'h2u', 'h2u@example.com', 110, 0, { name: 'Somebody Else' }));
});
test('a cooldown write cannot wipe a running ban, and a ban cannot be shortened', async () => {
  const g = bidder('h3u', 'h3u@example.com');
  await assertSucceeds(setDoc(doc(g, 'bidLimits/h3u'), { bannedUntil: new Date(Date.now() + 300000) }));
  await assertFails(setDoc(doc(g, 'bidLimits/h3u'), { lastBidAt: serverTimestamp() }));
  await assertFails(setDoc(doc(g, 'bidLimits/h3u'), { bannedUntil: new Date(Date.now() + 5000) }));
});
test('bidBlocks cannot be listed by a bidder, and a device block cannot be shortened', async () => {
  const g = bidder('h4u', 'h4u@example.com');
  await assertFails(getDocs(collection(g, 'bidBlocks')));
  await assertSucceeds(setDoc(doc(g, 'bidBlocks/dev_h4'), { bannedUntil: new Date(Date.now() + 300000) }));
  await assertFails(setDoc(doc(g, 'bidBlocks/dev_h4'), { bannedUntil: new Date(Date.now() + 5000) }));
});
function updateDocViaBatch(db, path, data) { const b = writeBatch(db); b.update(doc(db, path), data); return b.commit(); }
