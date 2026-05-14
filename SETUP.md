# Pre-Deploy Setup Checklist

Everything that **must** be done before the first deploy, in order.

## 1. Firebase project

- [ ] Firebase project exists with **Firestore**, **Authentication**, and **Storage** enabled.
- [ ] `firebase-applet-config.json` at repo root contains the real `apiKey`, `authDomain`, `projectId`, `appId`, `storageBucket`, and (if used) `firestoreDatabaseId`. This file IS bundled into the SPA — the `apiKey` is public by Firebase design and protected by Firestore rules + App Check, not by secrecy.

## 2. Authentication

- [ ] In Firebase Console → Authentication → Sign-in method → **Email/Password is enabled**.
- [ ] At least one admin account exists. Provision via the helper script:
  ```
  npm run users:provision
  ```
  (requires `firebase-admin` service-account JSON; see `scripts/create-team-users.cjs`).

## 3. Firestore rules — REQUIRED EDIT

- [ ] **Edit `firestore.rules` lines 17–20**: replace the placeholder admin emails
  (`owner@mobilephonemarket.example`, `ops@mobilephonemarket.example`) with the real Firebase Auth admin email(s).
  Without this, **no one passes `isAdmin()` and the entire app is locked out**.
- [ ] Deploy rules:
  ```
  firebase deploy --only firestore:rules
  ```

## 4. Firebase App Check (recommended)

- [ ] Enable App Check in Firebase Console with reCAPTCHA Enterprise (or v3) — protects the public `apiKey` from quota abuse.
- [ ] Enforce App Check on Firestore, Auth, and Storage after a short monitoring period.

## 5. Vercel deploy

- [ ] Connect this repo to a Vercel project.
- [ ] Set environment variables in Vercel project settings:
  - `VITE_IMGBB_API_KEY` — imgbb upload token (note: this is bundled into the SPA, so it's effectively public; rotate periodically).
  - `GEMINI_API_KEY` — if AI features are used.
- [ ] First deploy command (auto-detected): `npm run build` → `dist/`.

## 6. Post-deploy smoke test

- [ ] Visit the deployed URL, sign in with an admin account.
- [ ] Add a unit → confirm it appears in Firestore Console.
- [ ] Soft-delete a unit → confirm it lands in **Recently Removed** on the Stock In page with a 48 h countdown.
- [ ] Click Restore → confirm it returns to active inventory.
- [ ] Remove a pending SHS → confirm it appears on the **Stock Ticker tape** at the top and in the bell notification.
- [ ] Try `https://<your-domain>/?seed=1` while signed-out → should hit the login page, not the seed UI.

## Known operational gaps

These are intentional for the current "internal testing" phase:

- **No server-side purge job.** Soft-deleted rows are hard-deleted by the client when any operator is online with the app open. If no one opens the app for >48 h the deleted rows persist in Firestore. Add a scheduled Cloud Function (`functions/` directory) on the Blaze plan if this matters.
- **imgbb API key is bundled.** Vite `VITE_*` vars are always public. imgbb is free-tier; abuse cost is essentially zero. Replace with Firebase Storage if/when uploads become high-volume.
- **Single admin allow-list.** Multi-user support is descoped for now — edit the email list in `firestore.rules` to add staff.
- **Cloud Function scheduled cron** for purge / sweep is not deployed (see first bullet).

## Useful commands

```
npm run dev                # local dev server on :3000
npm run build              # production build → dist/
npm run lint               # tsc --noEmit type check
npm test                   # vitest run (includes .test.tsx after the glob fix)
firebase deploy --only firestore:rules
firebase deploy --only hosting   # if hosting on Firebase instead of Vercel
```
