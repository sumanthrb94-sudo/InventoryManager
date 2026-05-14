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

## 3. Firestore + Storage rules — REQUIRED EDIT

Both `firestore.rules` and `storage.rules` ship with placeholder admin emails.

- [ ] **Edit `firestore.rules` lines 17–20** and **`storage.rules` lines 13–16**: replace the placeholder
  emails (`owner@mobilephonemarket.example`, `ops@mobilephonemarket.example`) with the real Firebase Auth
  admin email(s). Without this, **no one passes `isAdmin()` and the entire app is locked out**.
- [ ] Deploy both rule sets:
  ```
  firebase deploy --only firestore:rules,storage
  ```

## 4. Firebase App Check (recommended)

- [ ] Enable App Check in Firebase Console with reCAPTCHA Enterprise (or v3) — protects the public `apiKey` from quota abuse.
- [ ] Enforce App Check on Firestore, Auth, and Storage after a short monitoring period.

## 5. Vercel deploy

- [ ] Connect this repo to a Vercel project.
- [ ] Set environment variables in Vercel project settings:
  - `GEMINI_API_KEY` — if AI features are used.
  - (Image uploads use Firebase Storage via the signed-in operator session — no upload token needed.)
- [ ] First deploy command (auto-detected): `npm run build` → `dist/`.

## 6. Post-deploy smoke test

- [ ] Visit the deployed URL, sign in with an admin account.
- [ ] Add a unit → confirm it appears in Firestore Console.
- [ ] Soft-delete a unit → confirm it lands in **Recently Removed** on the Stock In page with a 48 h countdown.
- [ ] Click Restore → confirm it returns to active inventory.
- [ ] Remove a pending SHS → confirm it appears on the **Stock Ticker tape** at the top and in the bell notification.
- [ ] Try `https://<your-domain>/?seed=1` while signed-out → should hit the login page, not the seed UI.

## Session policy

- Sessions auto-expire **1 hour** after sign-in (absolute, not idle-based). Configurable via `SESSION_MAX_AGE_MS` in `src/lib/firebase.ts`.
- Enforcement: the `AppWithAuth` component checks session age on mount, every 30 s, on tab visibility change, and via cross-tab `storage` events.
- When the timeout fires, the user is signed out and the next login page shows a one-time amber banner: *"Your 1-hour session expired. Please sign in again."*
- Manual sign-out still works (clears the timestamp + Firebase auth).
- Operators are forced through one extra sign-in after this code first deploys (existing persisted sessions have no timestamp).

## Known operational gaps

These are intentional for the current "internal testing" phase:

- **No server-side purge job.** Soft-deleted rows are hard-deleted by the client when any operator is online with the app open. If no one opens the app for >48 h the deleted rows persist in Firestore. Add a scheduled Cloud Function (`functions/` directory) on the Blaze plan if this matters.
- **No auto-cleanup of uploaded images.** `ImageCaptureInput` uploads to `stock-intake/` in Firebase Storage and the URL is persisted on the unit record. Nothing currently deletes the underlying file. If you want OCR-only / transient images, decide whether to (a) stop persisting `imageUrl`, or (b) add a scheduled sweep.
- **Single admin allow-list.** Multi-user support is descoped for now — edit the email list in `firestore.rules` and `storage.rules` to add staff.
- **Cloud Function scheduled cron** for purge / sweep is not deployed (see first bullets).

## Useful commands

```
npm run dev                # local dev server on :3000
npm run build              # production build → dist/
npm run lint               # tsc --noEmit type check
npm test                   # vitest run (includes .test.tsx after the glob fix)
firebase deploy --only firestore:rules
firebase deploy --only hosting   # if hosting on Firebase instead of Vercel
```
