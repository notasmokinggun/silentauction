// Run `npm run bump` before every deploy. Stamps one new version everywhere:
// SITE_VERSION in index.html, the firebase-init.js ?v= cache-buster, and version.json.
// Open pages poll version.json and refresh themselves when it changes.
const fs = require('fs');
const d = new Date();
const p = n => String(n).padStart(2, '0');
const v = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
let html = fs.readFileSync('index.html', 'utf8');
if (!/const SITE_VERSION = '[^']*';/.test(html)) throw new Error('SITE_VERSION not found in index.html');
html = html.replace(/const SITE_VERSION = '[^']*';/, `const SITE_VERSION = '${v}';`)
           .replace(/firebase-init\.js\?v=[^"']*/, `firebase-init.js?v=${v}`);
fs.writeFileSync('index.html', html);
fs.writeFileSync('version.json', JSON.stringify({ version: v }) + '\n');
console.log('Version is now ' + v);
