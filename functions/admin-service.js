// Dependency injection keeps authorization and transactions testable without credentials.
function createAdminService({ db, auth, HttpsError, timestamp, randomPassword }) {
  const approvals = db.collection('admins');
  function emailFrom(value) {
    if (typeof value !== 'string' || value.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      throw new HttpsError('invalid-argument', 'Enter a valid admin email address.');
    }
    return value.trim().toLowerCase();
  }
  async function requireAdmin(request, tx) {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in as an approved admin.');
    const ref = approvals.doc(request.auth.uid);
    const doc = tx ? await tx.get(ref) : await ref.get();
    if (!doc.exists || doc.data().approved !== true) {
      throw new HttpsError('permission-denied', 'Only approved admins can manage access.');
    }
    return request.auth.uid;
  }
  return {
    async list(request) {
      await requireAdmin(request);
      const snap = await approvals.where('approved', '==', true).get();
      const admins = await Promise.all(snap.docs.map(async doc => {
        // Bootstrap approvals may not yet have an email field.
        let email = doc.data().email;
        if (!email) {
          try { email = (await auth.getUser(doc.id)).email; }
          catch (err) { if (err.code !== 'auth/user-not-found') throw err; }
        }
        return { uid: doc.id, email: email || '(account no longer exists)', self: doc.id === request.auth.uid };
      }));
      return { admins: admins.sort((a, b) => a.email.localeCompare(b.email)) };
    },
    async add(request) {
      await requireAdmin(request);
      const email = emailFrom(request.data && request.data.email);
      let user;
      try { user = await auth.getUserByEmail(email); }
      catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
        try { user = await auth.createUser({ email, password: randomPassword() }); }
        catch (createError) {
          if (createError.code !== 'auth/email-already-exists') throw createError;
          user = await auth.getUserByEmail(email);
        }
      }
      if (user.disabled) throw new HttpsError('failed-precondition', 'This account is disabled. The Firebase project owner must review it.');
      await db.runTransaction(async tx => {
        const actor = await requireAdmin(request, tx);
        tx.set(approvals.doc(user.uid), { approved: true, email: user.email || email,
          updatedBy: actor, updatedAt: timestamp() }, { merge: true });
        tx.set(db.collection('adminAudit').doc(), { action: 'grant', actor, target: user.uid, email, at: timestamp() });
      });
      // Never return a password or a password-reset link to the operator.
      return { email: user.email || email };
    },
    async remove(request) {
      await requireAdmin(request);
      const uid = request.data && request.data.uid;
      if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) {
        throw new HttpsError('invalid-argument', 'Select an admin to remove.');
      }
      if (uid === request.auth.uid) throw new HttpsError('failed-precondition', 'You cannot remove your own admin access. Ask another admin.');
      await db.runTransaction(async tx => {
        // Reading the actor within the transaction prevents mutually revoked admins
        // from removing each other concurrently and leaving no approved admin.
        const actor = await requireAdmin(request, tx);
        const target = await tx.get(approvals.doc(uid));
        if (!target.exists || target.data().approved !== true) return;
        tx.set(approvals.doc(uid), { approved: false, updatedBy: actor, updatedAt: timestamp() }, { merge: true });
        tx.set(db.collection('adminAudit').doc(), { action: 'revoke', actor, target: uid, at: timestamp() });
      });
      // Revoke organizer permissions only; retain the person's guest account/bids.
      return { removed: true };
    },
  };
}
module.exports = { createAdminService };
