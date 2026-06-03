# Disaster Recovery

Three independent layers, each addressing a different failure mode.

| Layer | Purpose | Where it lives | RPO | RTO |
|---|---|---|---|---|
| **1. Firestore PITR** | Accidental delete, last-7-days rollback | Native GCP | 1 hour | minutes |
| **2. Scheduled GCS exports** | Project compromise, prolonged outage | Your GCS bucket | 1 day | 1-2 hours |
| **3. Manual JSON snapshots** | Operator-driven, share between envs | Local file / repo storage | on-demand | minutes |

---

## Layer 1: Firestore PITR (one-time setup)

Firestore's built-in point-in-time recovery. Restores any database state within a 7-day window. Free for the first 7 days; longer windows are paid.

**Enable once via gcloud**:

```bash
gcloud firestore databases update \
  --database='(default)' \
  --point-in-time-recovery
```

Or in the Cloud Console: **Firestore → Databases → (default) → Edit → Point-in-time recovery: ON**.

**Restore**:

```bash
gcloud firestore databases restore \
  --source-database='(default)' \
  --destination-database='restored-2026-06-03' \
  --snapshot-time='2026-06-03T14:00:00Z'
```

This creates a SECOND database — you switch the app to it (or copy specific collections back over). Native point-in-time, no manual intervention required.

---

## Layer 2: Scheduled GCS exports (recommended for production)

**Option A — gcloud one-liner** (run via cron / GitHub Actions / Cloud Scheduler):

```bash
gcloud firestore export \
  gs://YOUR-BACKUP-BUCKET/$(date -u +%Y-%m-%dT%H-%M-%SZ)
```

This dumps every collection to a folder in your Cloud Storage bucket. Restorable via:

```bash
gcloud firestore import gs://YOUR-BACKUP-BUCKET/2026-06-03T00-00-00Z
```

**Option B — Cloud Scheduler + Cloud Function** (fully managed):

1. Create a GCS bucket: `gsutil mb gs://inventorymanager-backups`
2. Grant the App Engine default service account `Storage Admin` on the bucket
3. Create a Cloud Function that calls `firestore.export(BUCKET)` (see GCP docs: [Scheduled exports](https://cloud.google.com/firestore/docs/solutions/schedule-export))
4. Cloud Scheduler triggers the function daily at 02:00 UTC

Storage cost: ~$0.02/GB/month in GCS Standard. A few hundred MB of inventory data = under $1/month.

---

## Layer 3: Manual JSON snapshots (in-app + CLI)

### In-app (admin Dashboard)

The admin Dashboard has a **Download Backup** button — clicks dump every collection to a JSON the operator saves offsite (Dropbox, USB, email to themselves). The matching **Restore from Backup** button takes a previously-downloaded JSON and merges it into the live DB.

Use case: ad-hoc snapshot before a risky operation (large import, schema migration test), or sharing a known-good state with a teammate's local dev environment.

### CLI

```bash
node scripts/firestore-backup.cjs
```

Writes `./backups/firestore-backup-<timestamp>.json`. Same content as the in-app download, but headless — wire it to cron for automated nightly snapshots in addition to GCS:

```cron
0 2 * * *  cd /path/to/InventoryManager && node scripts/firestore-backup.cjs
```

Stored under `./backups/` (gitignored). Rotate / upload elsewhere as you see fit.

---

## When to use which

| Failure mode | Fix |
|---|---|
| Operator accidentally deletes a sales batch | PITR (Layer 1) — restore to 5 minutes ago |
| Firestore data corruption / runaway script | PITR if <7 days, else most recent GCS export (Layer 2) |
| GCP project deletion / billing lapse | Most recent GCS export, restored to a fresh project (Layer 2) |
| "Want a snapshot before tonight's bulk import" | In-app Download Backup (Layer 3) |
| Move data to a new environment for testing | CLI script → upload via in-app Restore (Layer 3) |

---

## Test plan (monthly)

1. Run **Download Backup** from the admin Dashboard.
2. On a staging project, run **Restore from Backup** with that file.
3. Spot-check 3 random sales + 3 random inventory units match the source.
4. Trigger a fresh GCS export via gcloud, verify the folder lands in the bucket.

A backup that's never been restored is not a backup.
