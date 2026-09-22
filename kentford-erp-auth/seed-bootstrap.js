'use strict';
/* Run once (node seed-bootstrap.js) to create the first director-role account when data/db.json
   has no users yet. Safe to re-run — it is a no-op if any user already exists. Prints the
   generated password ONCE to stdout; nothing else displays it, so capture it immediately. */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

async function main() {
  const data = db.read();
  if (data.users.length > 0) {
    console.log('Users already exist (' + data.users.length + ') — bootstrap skipped.');
    return;
  }
  const email = process.env.BOOTSTRAP_EMAIL || 'admin@kentford.local';
  const password = process.env.BOOTSTRAP_PASSWORD || crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 14);
  const passwordHash = await bcrypt.hash(password, 10);
  const nowISO = new Date().toISOString();
  const user = {
    id: 'u_' + crypto.randomBytes(8).toString('hex'),
    name: 'Administrator',
    email,
    roleId: 'director',
    position: 'Direktur Utama',
    jabatan: 'Direktur Utama',
    deptId: '',
    location: '',
    approverId: '',
    approvalLimit: 0,
    delegateTo: '',
    status: 'active',
    passwordHash,
    resetToken: null,
    resetTokenExpiresAt: null,
    createdAt: nowISO,
    updatedAt: nowISO,
    deletedAt: null
  };
  data.users.push(user);
  db.write(data);
  console.log('Bootstrap director account created:');
  console.log('  email:    ' + email);
  console.log('  password: ' + password);
  console.log('Store this password somewhere safe now — it will not be shown again.');
}

main().catch(e => { console.error(e); process.exit(1); });
