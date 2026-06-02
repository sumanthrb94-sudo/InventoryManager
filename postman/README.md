# InventoryManager — Postman Collection (Firestore REST)

This folder contains a Postman v2.1 collection that exercises every Firestore collection the InventoryManager app reads and writes, plus six end-to-end scenario flows.

The app itself is a React + Firebase Firestore client with **no custom REST API** — the browser talks to Firestore directly via the Firebase SDK. For QA / external testing we use Firestore's REST API:

```
https://firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents
```

## Files

| File                                       | Purpose                                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `InventoryManager.postman_collection.json` | The Postman v2.1 collection. 11 folders, 40 requests, with collection variables and per-request test scripts.              |
| `README.md`                                | This file.                                                                                                                 |

## Import the collection

1. Open Postman → **Import** → drop in `postman/InventoryManager.postman_collection.json`.
2. The collection ships with its own variable set — there is **no separate environment file required**. Open the collection's **Variables** tab and fill in:

   | Variable     | Pull from                                                              |
   | ------------ | ---------------------------------------------------------------------- |
   | `projectId`  | `.env` — `FIREBASE_PROJECT_ID` (or `firebase-applet-config.json`)      |
   | `apiKey`     | `.env` — `FIREBASE_API_KEY`                                            |
   | `email`      | `ADMIN_EMAIL` of a Firebase Auth user with read/write on the project   |
   | `password`   | `ADMIN_PASSWORD` for that user                                         |

   The other variables (`idToken`, `imei`, `saleId`, `aggregateId`, `supplierId`, `shsUnitId`) are **populated automatically** by the Setup request and the scenario pre-request scripts.

   The collection also defines `baseUrl` and `authUrl` — leave these at their defaults.

## Required environment variables (where they live)

The InventoryManager repo reads its Firebase config from one of two places:
- `firebase-applet-config.json` (preferred — Studio drops this in)
- `.env` overrides — see `.env.example`:

```
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
```

For Postman you only need `FIREBASE_PROJECT_ID` and `FIREBASE_API_KEY`, plus an admin email + password to exchange for an ID token.

## Order to run

1. **A. Setup → Get ID Token** — POSTs to `identitytoolkit.googleapis.com/v1/accounts:signInWithPassword`. The test script stores `idToken` into collection variables; every other request authenticates with `Authorization: Bearer {{idToken}}`.
2. **B. Inventory Units (CRUD)** — Create / Get / List / Update (with `updateMask.fieldPaths`) / Delete / StructuredQuery.
3. **C. Inventory Aggregates** — Create an SHS aggregate, list aggregates.
4. **D. Sales** — Create / list / void a sale (composite id `${marketplace}__${orderNumber}`).
5. **E. Suppliers** — Create / list a supplier.
6. **F1 … F6 — Scenarios** — each folder is a sequential flow. Run requests **top-to-bottom inside the folder** — variables like `imei` and `saleId` are written by the pre-request script of the first request and consumed by every following request.

| Scenario | What it exercises                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| F1       | Add Office Stock + verify (`status='available'`, supplier linked)                                              |
| F2       | Add SHS aggregate (`quantityText='SHS'`, `coloursMap` of 4) + receive 4 IMEIs + decrement                      |
| F3       | Record a sale + flip the unit to `sold` + GET verify                                                           |
| F4       | Return to inventory + void linked sale (`voidedAt + voidReason`), verify on both docs                          |
| F5       | Return to supplier — **soft delete** (`status='returned'`, NO hard DELETE, doc still exists)                   |
| F6       | Sell an SHS placeholder unit — backfill IMEI first, then write the sale + verify                               |

## Firestore REST — typed value encoding

Every field in a Firestore REST body is wrapped in a **single-key typed object**. The keys match the Firestore wire format:

| Field type                | JSON shape                                                              |
| ------------------------- | ----------------------------------------------------------------------- |
| string                    | `{ "stringValue": "abc" }`                                              |
| integer                   | `{ "integerValue": "123" }` (string — JSON numbers can lose precision)  |
| double                    | `{ "doubleValue": 12.5 }` or `{ "doubleValue": "12.5" }`                |
| boolean                   | `{ "booleanValue": true }`                                              |
| null                      | `{ "nullValue": null }`                                                 |
| timestamp                 | `{ "timestampValue": "2026-05-17T09:00:00Z" }` (RFC 3339)               |
| array                     | `{ "arrayValue": { "values": [ { "stringValue": "x" }, … ] } }`         |
| map / nested object       | `{ "mapValue": { "fields": { "k": { "stringValue": "v" } } } }`         |
| document reference        | `{ "referenceValue": "projects/.../documents/coll/id" }`                |
| geo point                 | `{ "geoPointValue": { "latitude": 0, "longitude": 0 } }`                |
| bytes                     | `{ "bytesValue": "BASE64STRING" }`                                      |

A document body is `{ "fields": { <name>: <typedValue>, … } }`. See:
- https://cloud.google.com/firestore/docs/reference/rest/v1/Value
- https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/patch

### `updateMask.fieldPaths`

To update **only** a subset of fields without overwriting the whole document, add one `updateMask.fieldPaths` query param per field:

```
PATCH /documents/inventoryUnits/{imei}?updateMask.fieldPaths=status&updateMask.fieldPaths=salePrice
```

Anything outside the update mask is preserved. The CRUD folder's *Update unit* request and every Scenario request that does a partial write uses this.

### `runQuery` (StructuredQuery)

Equality filters on a single field don't need a composite index. The CRUD folder's last request demonstrates the syntax:

```json
POST /documents:runQuery
{
  "structuredQuery": {
    "from":  [ { "collectionId": "inventoryUnits" } ],
    "where": {
      "fieldFilter": {
        "field": { "fieldPath": "status" },
        "op":    "EQUAL",
        "value": { "stringValue": "available" }
      }
    },
    "limit": 50
  }
}
```

Response is a flat array of `{ "document": { "name", "fields", … } }` envelopes (one per match).

## Soft-delete pattern for returns

The Returns flow (`src/components/ReturnsPage.tsx → ProcessReturnModal.handleSave`) **never** hard-deletes a unit. It does the following:

1. `PATCH inventoryUnits/{imei}` with
   - `status='available'` (if `returnType='returned_to_inventory'`) **or** `status='returned'` (if `returnType='repair'` or `'returned_to_supplier'`)
   - `returnType`, `returnDate`, `returnReason`
   - clears every sale-side field (`salePrice`, `saleDate`, `salePlatform`, `saleOrderId`, `postageCost` → `null`)
   - if `returned_to_inventory`: also clears `platformListed` + `listingSites`
2. For every linked `sales/{id}` doc with `unitId === unit.id` and no existing `voidedAt`:
   - `PATCH sales/{id}` with `voidedAt = returnDate` + `voidReason = returnReason`

A voided sale stays in the `sales` collection for audit, but every Sell-side dashboard surface (`SellPage`, GP / Avg GP% / revenue rollups) filters out rows with `voidedAt` set. If the unit is later re-sold, a brand new sale doc is written; the old voided sale stays in place.

Scenario F5 demonstrates the same flow for `returned_to_supplier`: the unit's `status` is set to `'returned'` but the doc is preserved (assertion: GET returns 200 and `status='returned'`).

## Test assertions baked into the collection

Every request has at least:
- Status code check (200 / 204 where appropriate).
- A field-level assertion against the Firestore typed-value shape, e.g.

  ```javascript
  pm.expect(json.fields.status.stringValue).to.eql('available');
  ```
- For chained scenarios, the first request's pre-request script sets the canonical `imei` / `saleId` variables so the next request can reference `{{imei}}` / `{{saleId}}`.

## Caveats / limitations

- **Composite indexes** — any query that filters on more than one field or orders by a different field than the filter needs a composite index created in the Firebase console. The collection only ships a single-field structured query to avoid this requirement.
- **Auth scope** — `idToken` is short-lived (≈1 hour). If you see `401 UNAUTHENTICATED` re-run `A. Setup → Get ID Token`.
- **Server timestamps** — when the React app writes docs it uses `serverTimestamp()` (Firestore sentinel). The REST API doesn't accept that sentinel; the bodies in this collection send literal `timestampValue` strings instead. Functionally equivalent, but if you mix client-app writes with these REST writes you'll see two different write paths in audit logs.
- **`flags` array of unions** — `flags: ['top10', 'supplierHasStock', 'stockSold']` is encoded as `{ "arrayValue": { "values": [ { "stringValue": "top10" }, … ] } }`. The empty default is `{ "arrayValue": { "values": [] } }` — never `null`.
- **Hard delete vs soft delete** — `B. CRUD → Delete unit` performs a real DELETE. Don't use it on units linked to live sales; the canonical "remove a unit" flow is the soft delete demonstrated in F5.
- **`firestore.rules`** — every request runs as the authenticated admin user. If your `firestore.rules` restricts writes to a specific UID (e.g. only `ownerId == 'shared'`), make sure the doc bodies you send carry that ownerId — the seed bodies in this collection all use `"ownerId": "shared"` to match the existing app's convention.
