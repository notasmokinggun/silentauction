const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { randomBytes } = require('node:crypto');
const { createAdminService } = require('./admin-service');
initializeApp();
const service = createAdminService({ db: getFirestore(), auth: getAuth(), HttpsError,
  timestamp: () => FieldValue.serverTimestamp(), randomPassword: () => randomBytes(32).toString('base64url') });
const options = { region: 'us-central1', maxInstances: 3 };
exports.listAdmins = onCall(options, request => service.list(request));
exports.addAdmin = onCall(options, request => service.add(request));
exports.removeAdmin = onCall(options, request => service.remove(request));
