# Security Specification for Nexus Device Manager

## Data Invariants
- All documents must be authored by an authenticated user.
- A Device must belong to a valid Batch and Supplier.
- A Batch must belong to a valid Supplier.
- Devices have mutable status but immutable batchId and supplierId once set.
- Orders must contain at least one device ID and be linked to an authenticated user's workspace.

## The Dirty Dozen Payloads (Rejection Targets)

1. **Identity Spoofing**: Attempt to create a supplier with a fake `ownerId`.
2. **Missing Permissions**: Unauthenticated read on `devices`.
3. **Invalid ID Poisoning**: Creating a batch with a 2KB junk character string as ID.
4. **State Shortcut**: Updating a device from `available` directly to `returned` without being `sold` (logic dependent, but here we enforce type safely).
5. **PII Leak**: Authenticad user reading another user's `private_contacts` (if implemented).
6. **Shadow Update**: Adding a `isVerified: true` field to a Batch via client.
7. **Type Poisoning**: Sending `purchasePrice: "one hundred"` instead of 100.
8. **Size Attack**: Sending a `model` name that is 50,000 characters long.
9. **Relational Orphan**: Creating a Device with a `batchId` that doesn't exist.
10. **Timestamp Spoofing**: Sending a client-side `createdAt` for a new Batch.
11. **Email Spoof**: Accessing rules using an unverified email claiming to be admin.
12. **Blanket List**: Attempting to list all devices without a workspace/user filter.

## Test Runner (Draft)
`firestore.rules.test.ts` will verify these rejections.
