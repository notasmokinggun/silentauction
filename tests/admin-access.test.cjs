const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdminService } = require('../functions/admin-service');
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fixture() {
  const docs = new Map([['admins/owner', { approved: true, email: 'owner@example.com' }]]);
  const users = new Map([['owner@example.com', { uid: 'owner', email: 'owner@example.com' }]]);
  let id = 0, created = 0, revokeBeforeTransaction = false;
  const snapshot = key => ({ id: key.split('/')[1], exists: docs.has(key), data: () => docs.get(key) });
  const db = {
    collection(name) { return {
      doc(uid = 'audit-' + ++id) { return { key: name + '/' + uid, get: async () => snapshot(name + '/' + uid) }; },
      where() { return { get: async () => ({ docs: [...docs.keys()].filter(k => k.startsWith(name + '/') && docs.get(k).approved === true).map(snapshot) }) }; },
    }; },
    async runTransaction(fn) {
      if (revokeBeforeTransaction) docs.set('admins/owner', { approved: false });
      const pending = [];
      await fn({ get: async ref => snapshot(ref.key), set: (ref, value, options) => pending.push(() => docs.set(ref.key, options?.merge ? { ...docs.get(ref.key), ...value } : value)) });
      pending.forEach(write => write());
    },
  };
  const auth = {
    async getUserByEmail(email) { if (users.has(email)) return users.get(email); throw Object.assign(Error(), { code: 'auth/user-not-found' }); },
    async createUser({ email, password }) { assert(password); created++; const user = { uid: 'new-' + created, email }; users.set(email, user); return user; },
    async getUser(uid) { return [...users.values()].find(u => u.uid === uid); },
  };
  return { service: createAdminService({ db, auth, HttpsError, timestamp: () => 1, randomPassword: () => 'server-generated-secret' }), docs, users,
    owner: { auth: { uid: 'owner' }, data: {} }, created: () => created, revokeDuringRequest: () => { revokeBeforeTransaction = true; } };
}
test('all endpoints deny anonymous, guest and revoked callers', async () => {
  for (const endpoint of ['list', 'add', 'remove']) {
    const f = fixture();
    await assert.rejects(f.service[endpoint]({ data: { email: 'x@example.com', uid: 'other' } }), { code: 'unauthenticated' });
    await assert.rejects(f.service[endpoint]({ auth: { uid: 'guest' }, data: {} }), { code: 'permission-denied' });
    f.docs.set('admins/owner', { approved: false });
    await assert.rejects(f.service[endpoint](f.owner), { code: 'permission-denied' });
    assert.equal(f.created(), 0);
  }
});
test('add accepts email, creates Auth user server-side, writes approval and audit without returning secrets', async () => {
  const f = fixture();
  const result = await f.service.add({ ...f.owner, data: { email: '  NEW@Example.com ' } });
  assert.deepEqual(result, { email: 'new@example.com' });
  assert.equal(f.docs.get('admins/new-1').approved, true);
  assert.equal([...f.docs.keys()].filter(k => k.startsWith('adminAudit/')).length, 1);
  await f.service.add({ ...f.owner, data: { email: 'new@example.com' } });
  assert.equal(f.created(), 1, 'repeat grant must not create another account');
  assert.equal((await f.service.list(f.owner)).admins.length, 2);
});
test('invalid email and disabled account cannot be approved', async () => {
  const f = fixture();
  await assert.rejects(f.service.add({ ...f.owner, data: { email: 'invalid' } }), { code: 'invalid-argument' });
  f.users.set('disabled@example.com', { uid: 'disabled', email: 'disabled@example.com', disabled: true });
  await assert.rejects(f.service.add({ ...f.owner, data: { email: 'disabled@example.com' } }), { code: 'failed-precondition' });
  assert.equal(f.docs.has('admins/disabled'), false);
});
test('remove blocks self-removal and revokes only permissions, preserving Auth user', async () => {
  const f = fixture();
  await assert.rejects(f.service.remove({ ...f.owner, data: { uid: 'owner' } }), { code: 'failed-precondition' });
  await f.service.add({ ...f.owner, data: { email: 'new@example.com' } });
  await f.service.remove({ ...f.owner, data: { uid: 'new-1' } });
  assert.equal(f.docs.get('admins/new-1').approved, false);
  assert(f.users.has('new@example.com'));
  assert.equal((await f.service.list(f.owner)).admins.length, 1);
});
test('authorization is rechecked inside mutation transactions after concurrent revocation', async () => {
  for (const endpoint of ['add', 'remove']) {
    const f = fixture();
    f.docs.set('admins/other', { approved: true });
    f.revokeDuringRequest();
    await assert.rejects(f.service[endpoint]({ ...f.owner, data: { email: 'new@example.com', uid: 'other' } }), { code: 'permission-denied' });
    assert.equal(f.docs.has('admins/new-1'), false);
    assert.equal(f.docs.get('admins/other').approved, true);
  }
});
