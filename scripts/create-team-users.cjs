#!/usr/bin/env node
/**
 * Provision (or update) the team's Firebase Auth accounts.
 *
 * What this does:
 *   For each entry in ALLOWED_USERS (kept in sync with
 *   src/lib/firebase.ts), look up the user by email. If they exist,
 *   update password + display name; if they don't, create them.
 *   Idempotent — safe to run repeatedly when adding teammates or
 *   rotating passwords.
 *
 * What this needs:
 *   1. A Firebase service-account key with the Authentication Admin
 *      permission. Download from:
 *         Firebase Console → Project Settings → Service accounts →
 *         "Generate new private key"
 *      Save the JSON to `./firebase-service-account.json` (gitignored)
 *      or set FIREBASE_SERVICE_ACCOUNT=/abs/path.json.
 *
 *   2. The team's chosen passwords in `./scripts/team-passwords.json`
 *      (gitignored). Copy `team-passwords.example.json` to start.
 *      Format: { "<username>": "<password>", ... }
 *
 *   3. `npm install --save-dev firebase-admin`  (one-off, already in
 *      devDependencies if this script's been used before).
 *
 * Run:    node scripts/create-team-users.cjs
 *
 * Output: prints one line per user with their email + status (created
 *         / updated). Never prints the passwords.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVICE_ACCOUNT_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT ||
  path.join(REPO_ROOT, 'firebase-service-account.json');
const PASSWORDS_PATH =
  process.env.TEAM_PASSWORDS ||
  path.join(__dirname, 'team-passwords.json');

// Keep this list in sync with ALLOWED_USERS in src/lib/firebase.ts.
// If you change one, change the other.
const ALLOWED_USERS = [
  { username: 'admin',   email: 'admin@mpm.local',   displayName: 'Admin' },
  { username: 'sumanth', email: 'sumanth@mpm.local', displayName: 'Sumanth' },
  { username: 'ram',     email: 'ram@mpm.local',     displayName: 'Ram' },
  { username: 'ops1',    email: 'ops1@mpm.local',    displayName: 'Ops 1' },
  { username: 'ops2',    email: 'ops2@mpm.local',    displayName: 'Ops 2' },
];

function bail(msg) {
  console.error('\n✗ ' + msg + '\n');
  process.exit(1);
}

function loadJson(p, label) {
  if (!fs.existsSync(p)) {
    bail(`${label} not found at ${p}`);
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    bail(`${label} at ${p} is not valid JSON: ${err.message}`);
  }
}

function validatePassword(pw) {
  // Firebase Auth requires >= 6 chars but that's terrible. Enforce something
  // closer to "actually useful": 12+ chars with a mix of categories.
  if (typeof pw !== 'string') return 'must be a string';
  if (pw.length < 12) return 'must be at least 12 characters';
  const categories =
    (/[a-z]/.test(pw) ? 1 : 0) +
    (/[A-Z]/.test(pw) ? 1 : 0) +
    (/[0-9]/.test(pw) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);
  if (categories < 3) return 'must mix at least 3 of: lower, upper, digit, symbol';
  return null;
}

async function main() {
  // Lazy-require so the script can print a clear setup error before failing
  // on a missing module.
  let admin;
  try {
    admin = require('firebase-admin');
  } catch (err) {
    bail(
      'firebase-admin is not installed. Run:\n' +
      '    npm install --save-dev firebase-admin',
    );
  }

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    bail(
      `Service account key not found at ${SERVICE_ACCOUNT_PATH}\n` +
      '   Download from Firebase Console → Project Settings → Service\n' +
      '   accounts → "Generate new private key", save as the path above,\n' +
      '   or set FIREBASE_SERVICE_ACCOUNT to its absolute path.',
    );
  }

  const passwords = loadJson(PASSWORDS_PATH, 'Team passwords file');

  // Verify we have a password for every allowed user, and that each one is
  // strong enough. Fail BEFORE touching Firebase if anything is off.
  const problems = [];
  for (const u of ALLOWED_USERS) {
    const pw = passwords[u.username];
    if (!pw) {
      problems.push(`Missing password for "${u.username}"`);
      continue;
    }
    const issue = validatePassword(pw);
    if (issue) problems.push(`Password for "${u.username}" ${issue}`);
  }
  // Catch typos: passwords keyed under unknown usernames.
  for (const key of Object.keys(passwords)) {
    if (!ALLOWED_USERS.find(u => u.username === key)) {
      problems.push(`Unknown username in passwords file: "${key}"`);
    }
  }
  if (problems.length) {
    bail('Password file problems:\n   - ' + problems.join('\n   - '));
  }

  const serviceAccount = loadJson(SERVICE_ACCOUNT_PATH, 'Service account key');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log(`\nProvisioning ${ALLOWED_USERS.length} team accounts in project "${serviceAccount.project_id}"…\n`);

  let created = 0;
  let updated = 0;
  for (const u of ALLOWED_USERS) {
    const password = passwords[u.username];
    try {
      const existing = await admin.auth().getUserByEmail(u.email);
      await admin.auth().updateUser(existing.uid, {
        password,
        displayName: u.displayName,
        disabled: false,
      });
      console.log(`  ✓ updated  ${u.email}  (uid=${existing.uid})`);
      updated++;
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        const newUser = await admin.auth().createUser({
          email: u.email,
          password,
          displayName: u.displayName,
          emailVerified: true,
        });
        console.log(`  + created  ${u.email}  (uid=${newUser.uid})`);
        created++;
      } else {
        console.error(`  ✗ failed   ${u.email}: ${err.message || err}`);
        process.exitCode = 1;
      }
    }
  }

  console.log(`\nDone. ${created} created, ${updated} updated.\n`);
  console.log('Next: share each password with the matching teammate over a secure channel.');
  console.log('To rotate later: edit scripts/team-passwords.json and re-run this script.\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
