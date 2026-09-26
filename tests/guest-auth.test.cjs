const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', dataset: {}, hidden: false, textContent: '',
      querySelector(selector) { return node(id + selector); } });
    return nodes.get(id);
  };
  const writes = [], exchanges = [];
  let listener, failure = null;
  const user = { uid: 'google-user', displayName: 'Guest Example', email: 'guest@example.com',
    providerData: [{ providerId: 'google.com' }] };
  const auth = {
    currentUser: null, setPersistence: async () => {},
    onAuthStateChanged(fn) { listener = fn; },
    async signInWithCredential(credential) {
      exchanges.push(credential);
      this.currentUser = user;
      listener(user);
      return { user };
    },
    async signOut() { this.currentUser = null; listener(null); },
  };
  const firebaseAuth = { Auth: { Persistence: { LOCAL: 'local' } },
    GoogleAuthProvider: { credential: token => ({ idToken: token }) } };
  const context = {
    auth, firebase: { auth: firebaseAuth, firestore: { FieldValue: { serverTimestamp: () => 123 } } },
    GOOGLE_CLIENT_ID: 'configured-client', setTimeout: () => 1, clearTimeout: () => {},
    document: {
      getElementById: node,
      querySelectorAll: selector => ['s', 'p'].map(p => node(p + '-signin-area' + selector)),
      createElement: () => node('google-script'), head: { appendChild() {} },
    },
    google: { accounts: { id: { initialize() {}, renderButton() {} } } },
    db: { collection: collection => ({ doc: uid => ({
      get: async () => ({ exists: true, data: () => ({ phone: '+91 1234567890' }) }),
      set: async data => { if (failure) throw Error(failure); writes.push({ collection, uid, data }); },
    }) }) },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../guest-auth.js'), 'utf8'), context);
  return { context, node, writes, exchanges, user, fail: message => { failure = message; },
    state: expression => vm.runInContext(expression, context), restore() { auth.currentUser = user; listener(user); } };
}

test('Google token establishes Firebase session, saves private profile, and fills both views', async () => {
  const h = setup();
  await h.context.handleGoogleCredential({ credential: 'google-id-token' });
  assert.equal(h.exchanges[0].idToken, 'google-id-token');
  assert.equal(h.writes.length, 1, 'auth listener and callback share one profile save');
  assert.equal(h.writes[0].collection, 'users');
  assert.equal(h.writes[0].uid, h.user.uid);
  assert.equal(h.writes[0].data.email, h.user.email);
  assert.equal(h.node('s-name').value, h.user.displayName);
  assert.equal(h.node('p-email').value, h.user.email);
  assert.match(h.state('guestMessage'), /registration is saved/);
  h.node('p-phone').value = '';
  await h.context.saveRegistration('p');
  assert.equal(h.writes[1].data.phone, '', 'phone is optional');
  await h.context.auth.signOut();
  assert.equal(h.node('p-email').value, '');
  assert.equal(h.state('bidderProfile'), null);
  await assert.rejects(h.context.saveRegistration('s'), /Continue with Google/);
});

test('restored session persists profile and retains the existing optional phone', async () => {
  const h = setup();
  h.restore();
  await h.context.syncGuestProfile(h.user);
  assert.equal(h.node('p-phone').value, '+91 1234567890');
  assert.equal(h.writes.length, 1);
});

test('failed profile writes show an error and allow retry without another Google sign-in', async () => {
  const h = setup(); h.fail('permission-denied');
  await h.context.handleGoogleCredential({ credential: 'token' });
  assert.equal(h.state('bidderProfile'), null);
  assert.match(h.state('guestMessage'), /permission-denied/);
  assert.equal(h.node('p-signin-area[data-retry-profile]').hidden, false);
  h.fail(null);
  await h.context.syncGuestProfile(h.user);
  assert.equal(h.exchanges.length, 1);
  assert.equal(h.writes.length, 1);
});

test('missing credentials and network failures are visible; unsigned users cannot register', async () => {
  const h = setup();
  await h.context.handleGoogleCredential({});
  assert.match(h.state('guestMessage'), /did not return/);
  assert.equal(h.exchanges.length, 0);
  h.context.auth.signInWithCredential = async () => { throw Error('network-request-failed'); };
  await h.context.handleGoogleCredential({ credential: 'token' });
  assert.match(h.state('guestMessage'), /network-request-failed/);
  assert.equal(h.writes.length, 0);
  await assert.rejects(h.context.saveRegistration('p'), /Continue with Google/);
});
