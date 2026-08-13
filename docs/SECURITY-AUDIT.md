# Security audit log

Veda Mail keeps a privacy-bounded security audit trail for protected
control-plane and mailbox actions. An authenticated administrator can inspect
it from **Administration → Audit log**. The API is
`GET /api/v1/admin/audit`; it is administrator-only, rate-limited,
private/no-store, and accepts only `beforeSequence` plus a `1..200` `limit`.

## Recorded events

The current release records:

- successful, challenged, failed, and signed-out administrator/member
  authentication outcomes;
- first-run setup, administrator account, 2FA, capability, content-policy,
  mail-service, organization, and mailbox-user changes;
- member 2FA enable/disable and rule create/update/delete/toggle/reorder or
  reconciliation;
- contact/calendar exports and contact imports;
- Trash/Spam empty batches and permanent message destruction.

Delegation event names are reserved in the strict event contract. Veda Mail
does not claim delegation auditing until delegation itself is implemented.

Protected mutations write a durable `attempt` before the external or local
state change. They then write `success`, `failure`, or `partial`. If the attempt
cannot be persisted, the mutation fails closed. A `partial` event means the
state change may have applied but final audit settlement did not complete;
operators must reconcile it before retrying. Idempotent mailbox provisioning
retains its separate replay contract.

## Privacy boundary

`/data/security-audit.json` never contains mailbox addresses, administrator
usernames, provider credentials, message IDs, mailbox IDs, rule content,
subjects, bodies, contact/calendar content, IP addresses, or user-agent text.
Actors and optional targets are deterministic HMAC indexes derived under
dedicated HKDF subkeys from `VEDA_MAIL_JOB_KEY`. The UI shows only a short
prefix; the API returns the complete pseudonymous digest for correlation.

Each record is limited to action, outcome, time, sequence, pseudonymous actor
and target, an optional bounded affected count, a random event ID, and the
validated request correlation ID. Pseudonyms are still security-sensitive
metadata: protect exports, screenshots, and backups.

## Integrity and retention

Administrators configure live audit retention in the Audit log: 1 to 3,650
days and 100 to 10,000 records. The stricter limit wins; defaults are 365 days
and 10,000 records. A reduction is applied immediately. Expired entries advance
the authenticated anchor and `droppedCount`. If every prior event expires, a
pseudonymous system checkpoint keeps the chain non-empty and appendable,
so later appends and the retained suffix remain independently verifiable.
Retention changes themselves produce attempt/success or failure/partial audit
events. Backups can still contain expired events and need matching rotation.

Every entry authenticates its fixed-order fields and the previous entry digest
with HMAC-SHA-256. The complete strict version-1 file has a separate HMAC. Reads
verify the deployment-key check, whole-file MAC, chain links, and monotonic
sequence before returning any event. Modified, truncated, malformed, or
wrong-key stores fail closed.

The store retains the newest 10,000 events. When the bound is crossed, it
records the removed chain tip as the new anchor and increments `droppedCount`,
so the retained suffix remains verifiable and the UI discloses expiry. Writes
are process-serialized, mode 0600, fsynced, and atomically renamed in local
mode. When shared-state Redis is configured, the complete verified file is
wrapped in AES-256-GCM and migrated once without exposing event fields in
Redis. Exact-record compare-and-set retries serialize append and retention
updates across replicas while preserving one global sequence and HMAC chain.
Backend, ciphertext, key, or compare-and-set exhaustion errors fail closed.

The chain detects changes inside the current file; it cannot independently
prove that an attacker with volume-write access did not restore an older,
internally valid copy. Use immutable/off-host backup generations, recorded
checksums, restricted volume access, and external alerts for rollback evidence.

## Operations

- Keep the exact `VEDA_MAIL_JOB_KEY` with the installation. A different key
  intentionally makes the log unreadable. There is no in-place key migration.
- In local mode, back up `security-audit.json` with the complete `/data`
  snapshot. In shared mode, back up Redis consistently; the
  `.migrated-to-redis` file is a rollback archive, not the current log.
  Back up the external key separately in either mode.
- Before restore, preserve the current log or shared record and its checksum.
  Restoring an older generation also rolls audit history back to that snapshot.
  Drain audit-producing traffic before restoring Redis or a rollback archive.
- A missing file is a valid empty log. A malformed or non-pristine empty file
  is not accepted.
- Treat `failure` and `partial` outcomes as investigation signals. Correlate
  the request ID with structured application logs without adding private mail
  content to either system.

After an upgrade, sign in as administrator, open **Audit log**, confirm the
integrity-verified banner, perform a harmless policy save, and verify its
attempt/success pair. Also test a rejected login from a controlled client and
confirm that only pseudonymous metadata appears.
