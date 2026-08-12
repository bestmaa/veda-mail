# Backup, restore, and recovery

Veda Mail's durable state lives in `VEDA_MAIL_DATA_DIR`, mounted as `/data` in
the supplied Compose deployment.

## What `/data` contains

- Completed-installation state
- Administrator username and scrypt password hash
- Random 48-byte administrator session-signing secret and auth version
- Encrypted administrator TOTP secret and salted backup-code digests, if enabled
- Encrypted member TOTP secrets and salted backup-code digests in
  `member-security.json`, if members enabled Veda 2FA
- Per-provider/mailbox signature books, defaults, and revisions encrypted in
  `member-signatures.json`
- Per-provider/mailbox reusable template names, canonical subject/body content,
  and revisions encrypted in `member-templates.json`
- Per-provider/mailbox contacts, groups, recent-recipient ranking metadata, and
  revisions encrypted in `member-contacts.json`
- Per-provider/mailbox imported calendar events and revisions encrypted in
  `member-calendar-events.json`
- Per-provider/mailbox ordered mail rules, deployment state, and redacted
  control-plane audit encrypted in `member-rules.json`
- Per-provider/mailbox density, sort, preview, send-confirmation, and Undo Send
  delay preferences encrypted in `message-list-preferences.json`
- Per-provider/mailbox custom folder colors encrypted in
  `mailbox-appearance.json`
- Per-provider/mailbox saved-search names, canonical queries, and revisions
  encrypted in `saved-searches.json`
- Per-provider/mailbox portable label names, colors, opaque IDs, resumable
  deletion progress, and tombstones encrypted in `mail-label-catalog.json`
- Organization and product branding
- Organization member self-service policy in `organization-policy.json`
- Administrator-configured security-audit age/count retention in
  `data-retention-policy.json`
- Organization message, attachment, extension, and detected-MIME policy in
  `mail-content-policy.json`
- Optional normalized WebP logo
- Mail-provider endpoint and allowed-domain configuration, embedded in the
  atomic installation record
- Bounded `mail-user-provisioning-idempotency.json` safe results and keyed
  intent fingerprints; it contains no initial mailbox password
- Encrypted scheduled-message content, provider-draft references, retry state,
  and the minimum provider credential required by the background worker in
  `scheduled-jobs.json`
- Encrypted snooze intents, owned-mailbox identity, recovery locators, retry
  state, and bounded wake credentials in `snooze-jobs.json`
- The bounded HMAC-chained, pseudonymous security event trail in
  `security-audit.json`

It does not contain mailbox messages. Messages remain on the configured mail
server. Active member sessions disappear on restart in the default local mode.
When the optional shared Redis repository is configured, active sessions remain
only as authenticated ciphertext in that separately operated service and are
not part of `/data`. Scheduled-send and snooze books also move to authenticated
Redis ciphertext on first use; include Redis persistence and a consistent Redis
backup in every recovery drill. `.migrated-to-redis` files are rollback guards,
not the current queues. Message-list preference, saved-search, signature,
template, contact, and mailbox-color owner records also move as their existing
authenticated ciphertext; Redis, not their archived local files, is current
after migration. Saved-search, signature, template, and contact revisions plus
mailbox-color read-modify-write operations remain atomic in Redis, and an empty
book deletes its shared record. Contact recipient-history writes retry bounded
CAS conflicts so they do not erase simultaneous manual changes. Short-lived
immediate-send claim and replay records are also Redis-only; losing them can
remove duplicate-send protection for provider I/O that already happened, so
restore Redis before accepting sends. The deliberate job exception for provider
credentials is an encrypted, bounded scheduled or Undo Send job; it is deleted
after confirmed delivery or cancellation.
Bounded partial/uncertain delivery notices are Redis-only in shared-state mode;
losing Redis may remove those UI warnings before members review them.

`VEDA_MAIL_JOB_KEY` is deliberately separate from `/data`. Back it up in the
deployment secret manager. A `/data` backup without that exact key cannot
recover scheduled jobs, snooze jobs, mail-rule books, or the security audit
trail. Never rotate it while any of those files contains state. Veda Mail does
not currently provide an
in-place key migration;
simply changing the secret makes those stores fail closed. Preserve this key
for the installation lifetime and rehearse any exceptional migration on an
isolated restored copy first.

An older whole-volume restore also rolls the audit trail back. Before restore,
retain the current `security-audit.json` and its backup checksum as external
evidence. Do not merge audit files: each valid file is one authenticated chain.

Interrupted-compose recovery is browser-local IndexedDB state bound to one
member session. It is not stored in `/data`, is not included in server backups,
and expires with that session. Veda Mail attempts exact-session cleanup on
sign-out, server-issued expiry, or session invalidation. If browser cleanup
fails, mailbox content stays hidden and the member is told to retry secure
cleanup or clear the site's browser data. Members should save a provider draft
when they need cross-device durability; local attachment bytes are never part
of browser recovery.

The optional `VEDA_MAIL_STALWART_MANAGEMENT_API_KEY` is a deployment secret,
and `VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN` binds its destination. Neither is
`/data` state; manage them through the platform secret manager. Restoring
`/data` does not undo any mailbox already created in
Stalwart. Preserve the idempotency ledger with the installation so a restored
service does not blindly repeat a recent provisioning intent.

Always back up the entire volume as one unit. `installation.json` contains the
session secret required to decrypt `member-security.json`,
`member-signatures.json`, `member-templates.json`, `member-contacts.json`,
`member-calendar-events.json`, `mailbox-appearance.json`, and
`mail-label-catalog.json`; mismatched copies can
make member TOTP, signature, template, contact, mailbox-color, and label records
unrecoverable. Although
the metadata files contain encrypted owner buckets rather than raw addresses
or content, the same backup also contains
its decryption key. Protect the archive as sensitive mailbox-adjacent data.

Signature, template, contact, calendar-event, mailbox-appearance,
label-catalog, organization-policy, and mail-content-policy write serialization
is process-local,
as is the mail-rule store writer. Keep
exactly one Veda Mail process writing the volume, and stop that writer or use
an operator-verified atomic whole-volume snapshot. Never mount one writable
`/data` directory into multiple application replicas or merge individual
metadata files from different snapshots.

## Compose volume backup

First identify the actual volume name:

```bash
docker volume ls
docker compose config --volumes
```

From the repository directory on a Linux host, choose a private backup
directory, then stop writes:

```bash
mkdir -p backups
BACKUP_FILE="veda-mail-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
docker compose stop veda-mail
```

Archive the mounted volume through a one-off container:

```bash
docker compose run --rm --no-deps --user 0:0 \
  --entrypoint sh \
  -e BACKUP_FILE="$BACKUP_FILE" \
  -v "$PWD/backups:/backup" \
  veda-mail \
  -c 'tar -czf "/backup/$BACKUP_FILE" -C /data .'
docker compose start veda-mail
sha256sum "backups/$BACKUP_FILE"
```

Store the archive and checksum outside the server. If your platform provides
atomic volume snapshots, use that feature instead.

Encrypt backup archives at rest and restrict access. Treat them like
administrator credentials.

Dokploy users should schedule backups for the volume mounted at `/data` and
periodically test restoration to a separate non-production service.

## Automated offline byte-verification drill

After taking an operator-verified offline copy or atomic snapshot, exercise the
archive path without touching the live volume:

```bash
mkdir -m 700 /var/tmp/veda-mail-restore-drill
npm run backup:drill -- \
  --source /path/to/offline-data-copy \
  --work-dir /var/tmp/veda-mail-restore-drill
```

The output directory must be empty and outside the source. The drill rejects
symlinks/special files, more than 20,000 entries, or more than 4 GiB; creates a
normalized `veda-mail-data.tar.gz`; restores it into an isolated directory;
and compares every relative path, regular-file mode, byte length, and SHA-256
digest. `drill-report.json` records archive and manifest hashes for the recovery
record. A mismatch fails without deleting the source or output evidence.

This byte drill does not prove application/provider behavior. Continue with the
isolated service checks below, using the exact deployment secrets—including
`VEDA_MAIL_JOB_KEY`—and never point the drill instance at production workers or
outbound delivery unless the dedicated test account is isolated.

## Bind-mount backup

If `/data` is a bind mount, stop the service and copy the entire directory with
ownership, permissions, timestamps, and hidden files preserved. Do not copy
individual JSON files while the application is writing them.

## Restore

Restore into a fresh Compose project first, never over the only production
volume:

```bash
export COMPOSE_PROJECT_NAME=veda-mail-restore
export VEDA_MAIL_PORT=3100
export BACKUP_FILE=veda-mail-data-YYYYMMDDTHHMMSSZ.tar.gz

docker compose run --rm --no-deps --user 0:0 \
  --entrypoint sh \
  -e BACKUP_FILE="$BACKUP_FILE" \
  -v "$PWD/backups:/backup:ro" \
  veda-mail \
  -c 'test -z "$(ls -A /data)" &&
      tar -xzf "/backup/$BACKUP_FILE" -C /data &&
      chown -R 1001:1001 /data'
docker compose up -d
curl --fail http://127.0.0.1:3100/api/health
```

Then sign in to `/admin` on the isolated instance and test one member login.
For a production cutover, stop the old project, point the reverse proxy at the
verified restored project, and preserve the old volume until validation is
complete.

Restoring an older backup also restores its administrator credentials,
branding, provider profile, setup lock, signature books/defaults, reusable
templates, contacts, groups, and recent-recipient history as of that snapshot.
Existing local member sessions are not restored. Shared Redis sessions follow
the Redis backup/TTL lifecycle and require the exact `VEDA_MAIL_JOB_KEY`; isolate
or flush the test prefix before a restore drill so it cannot reach production
sessions. Do not restore
`member-signatures.json`, `member-templates.json`, or `member-contacts.json`
without the matching `installation.json`; an authentication or decryption
failure is intentionally reported as an unavailable store rather than falling
back to untrusted plaintext.

## Administrator recovery

Before enabling admin 2FA, set a separate random deployment secret:

```bash
openssl rand -hex 32
```

Store its output as `VEDA_MAIL_ADMIN_RECOVERY_TOKEN` in the deployment secret
manager. Do not reuse the setup token, admin password, or an authenticator
backup code.

If the admin password is forgotten, or both the authenticator device and all
backup codes are lost, open an interactive terminal inside the running Veda
Mail container and run:

```bash
node /app/scripts/admin-recovery.mjs
```

Enter the recovery token and new password at the hidden prompts, then type
`RESET`. The command atomically resets the password, removes administrator 2FA
and its backup codes, increments the authentication version, and invalidates
every existing administrator session. It preserves branding and mail-provider
configuration. Enable 2FA again after signing in.

The recovery token is never accepted by a web API. Rotate the deployment
secret after using it and redeploy. Do not manually edit or delete
`installation.json`.

## Recovery rehearsal

At least quarterly:

1. Restore the latest backup to an isolated hostname.
2. Confirm `/setup` remains locked.
3. Confirm administrator login.
4. Confirm branding and provider configuration.
5. Test a dedicated non-production mailbox.
6. Confirm that mailbox's saved signatures/defaults, templates, contacts,
   groups, and recent-recipient history were restored.
7. Insert one template and one signature into a test compose without sending to
   a real recipient, then select one restored contact and group from recipient
   autocomplete.
8. Export the restored contacts as vCard and import them into a clean dedicated
   test identity; verify names, addresses, and category-derived groups.
9. Run the offline byte-verification drill and retain its report/checksums with
   the rehearsal record.
10. Confirm the configured audit retention, external-log retention, and backup
    rotation match the published privacy notice.
11. Delete the isolated environment after recording the result.

Never test a restore by overwriting the only production volume.
