# Docker, Dokploy, and reverse-proxy deployment

Complete [installation prerequisites](INSTALLATION.md) first. All production
deployments require HTTPS, one durable `/data` volume, a strong setup token,
an explicit provider-host allowlist, and the correct public Veda Mail URL.

## Published GHCR image

Veda Mail publishes a signed application image for both `linux/amd64` and
`linux/arm64`. The secure-attachment Compose topology currently requires an
`amd64` Docker server because the approved official ClamAV 1.5.3 image that
passes the project's strict vulnerability gate is published for
`linux/amd64` only.
The deployment preflight fails closed on other architectures instead of
silently disabling malware scanning.

```bash
docker pull ghcr.io/bestmaa/veda-mail:sha-<full-main-commit>
```

The `latest` tag follows protected `main`. Each release also publishes one
immutable `sha-<full-main-commit>` tag. Treat `latest` as a discovery alias,
not a production pin. Verify the immutable tag's OCI index and both runtime
manifests, then pin the index digest in portable Compose deployments:

```dotenv
VEDA_MAIL_IMAGE=ghcr.io/bestmaa/veda-mail:sha-<full-main-commit>@sha256:<verified-index-digest>
```

An architecture-fixed deployment may instead pin the verified runtime child
digest, for example
`ghcr.io/bestmaa/veda-mail@sha256:<verified-amd64-child-digest>`. The OCI index
digest and its amd64/arm64 child digests are different values; record both and
verify the selected child's `org.opencontainers.image.revision` label matches
the full protected-main commit before deployment.

Published images include an SBOM, OCI provenance, and a GitHub artifact
attestation. Both platform variants are scanned at their exact candidate
digest before release tags are promoted. Anonymous pulls work once the GHCR
package is public.

## Docker Compose

```bash
git clone https://github.com/bestmaa/veda-mail.git
cd veda-mail
cp .env.example .env
# Keep all three outputs separate.
openssl rand -hex 32
openssl rand -hex 32
openssl rand -base64 32
```

Set the first two hex outputs as different setup/recovery tokens, the base64
output as the scheduled-job, rules, snooze, and security-audit root key, and
the deployment-specific values in `.env`:

```dotenv
VEDA_MAIL_SETUP_TOKEN=your-64-character-generated-value
VEDA_MAIL_ADMIN_RECOVERY_TOKEN=a-different-64-character-generated-value
VEDA_MAIL_JOB_KEY=the-base64-output-from-openssl
VEDA_MAIL_ATTACHMENT_KEY=a-separate-base64-32-byte-key-for-shared-quarantine
VEDA_MAIL_ALLOWED_PROVIDER_HOSTS=mail.example.com
VEDA_MAIL_STALWART_MANAGEMENT_API_KEY=optional-dedicated-api-key
VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN=https://mail.example.com
VEDA_MAIL_PUBLIC_URL=https://webmail.example.com
VEDA_MAIL_TRUST_PROXY_HEADERS=false
VEDA_MAIL_RATE_LIMIT_REDIS_URL=
VEDA_MAIL_RATE_LIMIT_REDIS_PREFIX=veda-mail:rate-limit:v1
VEDA_MAIL_METRICS_TOKEN=optional-output-from-openssl-rand-hex-32
VEDA_MAIL_CLAMAV_HOST=clamav
VEDA_MAIL_CLAMAV_PORT=3310
VEDA_MAIL_CLAMD_CONFIG_PATH=./config/clamd.conf
```

The provider allowlist contains hostnames only. The public URL is the Veda Mail
origin, uses HTTPS, and has no trailing slash. Then:

```bash
./scripts/check-clamav-platform.sh
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 veda-mail
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/ready
```

The supplied release Compose file uses the published GHCR image and contains no
application `build` section. This prevents platforms that append `--build` from
trying to retag an immutable digest reference. It also starts the official
Alpine-based ClamAV 1.5.3 `linux/amd64` image at an immutable
digest. CI scans that exact digest with pinned Trivy settings and rejects any
HIGH or CRITICAL vulnerability or detected secret. ClamAV is reachable only
on the private Compose network; its signature database is kept in the
`clamav-signatures` volume. To build the checked-out Veda Mail source instead,
explicitly add the source-build override:

```bash
docker compose -f compose.yaml -f compose.build.yaml up --build -d
```

### Dokploy Compose deployment

Use a repository-backed **Git** or **GitHub** Compose provider for production,
not an independently maintained single-service Raw definition. Configure the
public repository URL, protected `main` branch, and `./compose.yaml` path, then
pin `VEDA_MAIL_IMAGE` to the verified immutable release digest. Do not add
`compose.build.yaml` to a production deployment. Preview the
converted Compose before deploying and require both `veda-mail` and `clamav`
services to be present.

Dokploy clears checked-out source directories during redeployment, so create an
Advanced -> Volumes -> File Mount named `clamd.conf` whose content matches
`config/clamd.conf`, and set:

```dotenv
VEDA_MAIL_CLAMD_CONFIG_PATH=../files/clamd.conf
```

Keep `veda-mail-data` and `clamav-signatures` as Compose named volumes. A stable
Dokploy Compose project name reattaches the existing volumes on every rollout
and keeps them eligible for Volume Backups. Do not replace `/data` with a new
bind mount during an upgrade unless a verified byte-for-byte migration and
rollback have been completed. The scanner address must remain the private
Compose service name `clamav`; never publish port 3310 or point it at an
untrusted host.

Compose mounts the repository-pinned `config/clamd.conf` read-only and caps the
sidecar at two CPUs, 3 GiB memory, 128 PIDs, and a 256 MiB no-exec temporary
filesystem. The policy accepts at most a 50 MiB input and caps expanded scan
content at 100 MiB, recursion at eight levels, contained files at 1,000, and
ZIP scan time at 90 seconds. `AlertExceedsMax` and encrypted-content alerts are
enabled, so ClamAV cannot silently skip a bounded or encrypted member and return
an application-level clean verdict. `npm run check:clamav-config` verifies the
source policy, and CI confirms the running container uses the exact file.

ClamAV is fail-closed and may take several minutes to download/load signatures
on its first start. Until it is healthy, normal mail remains available but
attachment uploads return a recoverable scanner-unavailable error and received
inline CID images remain blocked instead of bypassing inspection. Budget at
least 4 GB RAM for ClamAV because signature reloads temporarily use additional
memory. Check both services:

```bash
docker compose ps
docker compose logs --tail=100 clamav
```

Pending upload ciphertext defaults to process-local temporary data, capped at
512 MiB and 1,000 active records. It expires after 30 minutes through a
background sweep; local files are intentionally excluded from backups. When
shared state Redis is configured, set the same independent
`VEDA_MAIL_ATTACHMENT_KEY` on
every replica. Metadata uses authenticated encryption and already-encrypted
ciphertext is stored in bounded chunks behind opaque attachment IDs; reserve,
quota, claim, release, consume, removal, and expiry transitions are serialized.
Redis persistence may briefly capture these TTL-bound ephemeral chunks; an
expired restore removes them automatically. Budget roughly 700 MiB plus Redis
overhead for the base64-expanded 512 MiB maximum and keep a no-eviction policy.

Interactive sessions idle-expire after 30 minutes and have a non-extendable
12-hour absolute lifetime. They are individually revocable and process-local by
default, so a restart signs everyone out. Configure
`VEDA_MAIL_STATE_REDIS_URL`, `VEDA_MAIL_STATE_REDIS_PREFIX`, and the same
`VEDA_MAIL_JOB_KEY` on every process to keep AES-256-GCM-encrypted sessions in
an atomic Redis repository. Raw bearer IDs, owners, addresses, and provider
credentials never appear in Redis keys or plaintext values. Use `rediss://`, a
no-eviction policy, persistence/backups, least-privilege credentials, and
monitoring; a configured outage or invalid ciphertext fails access closed.
The same repository stores scheduled-send and snooze owner books as ciphertext.
Enable it first with one replica: first access migrates the local JSON books and
renames them with `.migrated-to-redis`; back up Redis before scaling out.
It also stores connection-scoped immediate-send claims and bounded replay
receipts as ciphertext. Exactly one replica owns provider I/O; peers poll and
replay the result, while a configured Redis outage fails send state closed.
Partial and uncertain delivery notices use separate encrypted, HMAC-opaque
connection buckets. Append, list, dismissal, expiry, global capacity
compression, and remote-session cleanup are serialized across replicas.
`/api/ready` reports the configured shared state store as a bounded dependency and
returns 503 while it cannot answer `PING`.

A separate optional Redis-compatible backend coordinates every global,
trusted-source, and subject window across processes. Configure
`VEDA_MAIL_RATE_LIMIT_REDIS_URL`
with a secret-managed `rediss://` URL and an optional deployment-specific
`VEDA_MAIL_RATE_LIMIT_REDIS_PREFIX`. Redis keys are HMAC-pseudonymized and a
configured backend fails protected requests closed. `/api/ready` probes it.
Shared sessions, jobs, send claims, notices, quarantine, and limits still do
not remove the general one-replica requirement because mutable `/data` stores
are not yet transactional across writers.

Received-download ciphertext is a separate 15-minute, request-scoped spool
with the same 512 MiB/1,000-record process ceiling and random mode-0600 files in
a mode-0700 directory. Known and unknown provider lengths are supported under
the 50 MiB file limit. Each active stage reserves that full ceiling until its
actual clean length is known. Direct delivery and Download all use only the fully
scanned staged copy, then delete it on EOF, cancellation or failure; a failed
delete remains quota-accounted and is retried by the background sweep. Startup
removes only bounded stale spool directories whose recorded owner process is no
longer alive; neither plaintext nor ciphertext is included in backups.

Message-list preferences create
`/data/message-list-preferences.json` on first save. Keep it on the same durable
volume as `installation.json`: its AES-256-GCM key derives from that
installation's session secret, so neither file is portable by itself. With
shared-state Redis, first access atomically copies encrypted owner buckets and
renames the local file with `.migrated-to-redis`; back up Redis before scaling.
All replicas must retain the same installation session secret and Redis prefix.
An unavailable backend, invalid ciphertext, or a local file reappearing after
migration fails preferences closed. No Stalwart or provider migration is needed.

Saved searches follow the same one-replica migration procedure for
`/data/saved-searches.json`. Redis receives only the existing authenticated
ciphertext behind the HMAC-opaque owner key and the local file is archived as
`.migrated-to-redis`. Updates and final-book deletion use an atomic
compare-and-set against the exact encrypted record read by the replica; a lost
race returns the normal saved-search revision conflict. Preserve the
installation session secret and include the Redis prefix in backup and rollback
planning.

Mailbox colors follow the same guarded migration for
`/data/mailbox-appearance.json`. Exact-record compare-and-set plus bounded retry
preserves concurrent updates to different folders, and removing the final color
deletes the owner record. Redis contains only the existing authenticated
ciphertext behind the HMAC-opaque owner key. Use the same one-replica rollout,
backup, session-secret, and rollback precautions as saved searches.

Email signatures follow the same guarded migration for
`/data/member-signatures.json`. Their existing encrypted owner books move to
Redis unchanged; exact-record CAS preserves the public revision-conflict
contract across replicas, and deleting the final signature removes the owner
record. Verify the archive and Redis backup with one upgraded replica before
scaling or rolling back.

Email templates use the same ciphertext-only migration and exact-record CAS for
`/data/member-templates.json`. Concurrent replicas retain the existing revision
conflict contract, and deleting the final template removes the shared owner
record. Verify the archive and Redis backup on one upgraded replica before
scaling; preserve the installation session secret and Redis prefix for recovery.

Contacts use the same guarded ciphertext migration for
`/data/member-contacts.json`. Manual edits preserve revision conflicts through
exact-record CAS; automatic recent-recipient updates use bounded CAS retry so a
concurrent contact or group edit is retained. Empty contact books remove their
shared record. Verify the archive and Redis backup on one upgraded replica,
and preserve the installation session secret and Redis prefix.

Calendar events migrate as existing authenticated ciphertext from
`/data/member-calendar-events.json`. Exact-record CAS preserves revision
conflicts across replicas. Removing the final event deliberately retains its
encrypted empty-book revision, matching the local store contract. Verify the
archive and Redis backup on one upgraded replica before scaling, and preserve
the installation session secret and Redis prefix.

Portable label catalogs migrate as existing authenticated ciphertext from
`/data/mail-label-catalog.json`. Bounded exact-record CAS retries preserve
concurrent label changes, deletion leases, tombstones, and mailbox-empty
checkpoints across replicas. Verify the archive and Redis backup on one upgraded
replica before scaling, and preserve the installation session secret and prefix.

Audit retention creates `/data/data-retention-policy.json` only after the
administrator changes its 365-day/10,000-record defaults. The strict mode-0600
record is atomic, and older builds ignore it. Enforcement runs on audit append/read and
immediately after policy updates; it requires no worker or provider change.

Contacts create `/data/member-contacts.json` lazily on the first contact,
group, or confirmed recent-recipient write. The file contains only HMAC-indexed,
AES-256-GCM-encrypted owner books and must stay with the matching
`installation.json`, whose session secret derives its key. No environment
variable, Stalwart/IMAP setting, provider migration, CardDAV service, scheduled
worker, or new port is required. Writes are atomic but process-serialized, so
keep one Veda Mail writer for the mounted `/data` volume.

RFC 5322 mail export/import needs no new storage, port, worker, or environment
variable. Export streams provider sources through the application; import sends
each source directly to JMAP `Email/import` or IMAP `APPEND`. Standard IMAP
servers must advertise UIDPLUS so Veda Mail can return an exact imported UID.

Mail rules create `/data/member-rules.json` lazily on the first rule mutation.
Keep that file with the matching external `VEDA_MAIL_JOB_KEY`: owner indexes,
rule books, deployment state, redacted audit entries, and the short-lived
deployment intent are encrypted with Rules-specific HKDF subkeys. A restored
file with the wrong key fails closed. Keep one writer for the mounted `/data`
volume. Successful or failed provider deployment removes the stored provider
connection; native Sieve executes the rule without a Veda worker.

Snooze creates `/data/snooze-jobs.json` lazily on first use. Keep it with the
same `VEDA_MAIL_JOB_KEY`: owner indexes include a stable provider-account scope,
and owned-mailbox intent, provider recovery locators, wake time, bounded retry
state, and the minimum current connection needed by the worker are encrypted
with Snooze-specific HKDF subkeys. A wrong restore key fails closed. The worker
uses process-local serialization and durable leases, so run exactly one Veda
Mail application replica against a `/data` volume; rolling overlap and multiple
writers are unsupported until a shared transactional store and distributed
lease are implemented. No additional inbound port is required.

Stalwart JMAP Sieve requires no additional public Veda Mail port. For a Standard
IMAP/SMTP provider, optionally configure its ManageSieve hostname, usually port
4190, and select TLS or STARTTLS in the admin mail-service form. Add that
hostname to `VEDA_MAIL_ALLOWED_PROVIDER_HOSTS`. The Veda Mail container needs
outbound access to the endpoint, but its port must not be published from the
Veda Mail service.

The default bind is `127.0.0.1:3000`. Keep it that way behind a local reverse
proxy. To bind another host port:

```dotenv
VEDA_MAIL_BIND_ADDRESS=127.0.0.1
VEDA_MAIL_PORT=3100
```

Do not expose the container directly to the internet over HTTP.

### Generic ManageSieve live acceptance

The production image includes a deliberately manual acceptance runner for the
standard IMAP/SMTP rules adapter. Run it only from an application container
that already has the Stalwart management origin and API key configured and can
reach the provider's IMAP, SMTP, and ManageSieve endpoints:

```sh
node scripts/manage-sieve-live-acceptance.mjs
```

The runner creates a uniquely prefixed temporary mailbox, starts a second Veda
Mail process on an unexposed loopback port with a fresh temporary data
directory and job key, and configures that process for TLS IMAP/SMTP plus
STARTTLS ManageSieve. It verifies rule and vacation capability discovery,
independent optimistic conflicts, ordering, rule disable/enable, a dated HTML
vacation enable/reload/disable round trip that preserves the rules, bounded
dry-run results, redacted audit history, and independent SMTP delivery that is
marked read and starred by the active Sieve rules. Its `finally` path stops the
isolated process, removes the temporary data directory, and destroys only the
exact account created by that run.

If the configured management key is intentionally read-only, an operator may
instead supply a freshly created mailbox through
`VEDA_MAIL_ACCEPTANCE_USERNAME` and `VEDA_MAIL_ACCEPTANCE_PASSWORD`. The runner
accepts only an address in the configured acceptance domain whose local part
starts with `veda-accept-`; it never deletes an operator-supplied account. The
operator must delete that exact mailbox immediately after the run and record
cleanup as part of the acceptance evidence.

The command prints no mailbox password, provider credential, script content,
or ownership marker. A failed cleanup is a failed acceptance run and must be
resolved before rerunning. Never replace its generated account with an existing
mailbox, expose the loopback listener, or run it while management access points
at a different organization.

The release gate also has an opt-in, provider-neutral protocol integration test.
Set `VEDA_MAIL_TEST_MANAGESIEVE_HOST`,
`VEDA_MAIL_TEST_MANAGESIEVE_USERNAME`, and
`VEDA_MAIL_TEST_MANAGESIEVE_PASSWORD` for a fresh `veda-accept-*` mailbox before
running `tests/integration/manage-sieve-live.test.ts`. The test refuses a normal
mailbox, requires an empty script list, and removes its exact probe script in a
`finally` block. Network filtering can make this test unreachable from CI; the
container acceptance runner remains authoritative for production evidence.

## Dokploy

1. Create a project, then create a Compose service.
2. Connect `https://github.com/bestmaa/veda-mail` or paste `compose.yaml`.
   Select an `amd64` worker; the approved ClamAV sidecar is not currently
   published for `arm64`.
3. Add a persistent named volume mounted at `/data`.
   Keep the Compose-managed `clamav-signatures` volume as well.
4. Add these environment variables as secrets:

```text
VEDA_MAIL_SETUP_TOKEN=<openssl rand -hex 32>
VEDA_MAIL_ADMIN_RECOVERY_TOKEN=<a separate openssl rand -hex 32 value>
VEDA_MAIL_DATA_DIR=/data
VEDA_MAIL_JOB_KEY=<a separate base64-encoded 32-byte key>
VEDA_MAIL_ATTACHMENT_KEY=<required with shared-state Redis>
VEDA_MAIL_ALLOWED_PROVIDER_HOSTS=mail.example.com
VEDA_MAIL_STALWART_MANAGEMENT_API_KEY=<optional dedicated Stalwart API key>
VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN=https://mail.example.com
VEDA_MAIL_TRUST_PROXY_HEADERS=false
VEDA_MAIL_RATE_LIMIT_REDIS_URL=<optional rediss URL for shared request throttling>
VEDA_MAIL_PUBLIC_URL=https://webmail.example.com
VEDA_MAIL_CLAMAV_HOST=clamav
VEDA_MAIL_CLAMAV_PORT=3310
```

5. Set the application/container port to `3000`.
6. Add the public domain, for example `webmail.example.com`.
7. Enable HTTPS and certificate issuance.
8. Deploy and wait until the health check is healthy.
9. Open `https://webmail.example.com/setup`.
10. Complete the [first-run wizard](INSTALLATION.md#the-setup-wizard).
11. Enable administrator 2FA under `/admin` → **Security**, and store its
    one-time backup codes safely.
12. If the Stalwart management key is configured, open **Mailbox users** and
    verify list/detail plus one dedicated non-production account creation.

Do not expose SMTP, IMAP, Submission, or ManageSieve ports from Veda Mail.
Those belong to the mail-server deployment, not this webmail container.
Do not set `VEDA_MAIL_PUBLIC_URL` to the Stalwart hostname; it must be the
browser-facing Veda Mail hostname configured in step 6.

## Reverse proxy

Proxy HTTPS requests to `127.0.0.1:3000` or to the Compose service on its Docker
network. Preserve the original host and HTTPS scheme. Recommended behavior:

- Redirect HTTP to HTTPS.
- Enable WebSocket/HTTP streaming support.
- Permit raw attachment `PUT` requests up to 18 MiB plus HTTP overhead; keep
  request streaming enabled and allow at least five minutes for steadily
  progressing mobile uploads. Organization-logo JSON remains much smaller.
- Permit explicit attachment-preview `POST` requests and responses up to
  1 MiB. Do not rewrite them to `GET`, prefetch them, cache them, buffer them
  beyond proxy necessities, or loosen their response CSP/content type.
- Permit message-nested inline-image `POST` requests and WebP responses up to
  5 MiB. Do not rewrite them to `GET`, prefetch them, cache or transform them,
  buffer them, or loosen their no-store/nosniff/sandbox/CORP headers. Set the
  per-request upstream/read timeout above the application's 90-second
  preparation deadline plus its 30-second response deadline; 150 seconds is
  suitable. These requests use the existing provider and private ClamAV
  connections; no Stalwart change or new public port is required.
- Stream attachment `GET` responses without proxy buffering or transformation;
  the application enforces a 50 MiB decoded-byte ceiling for one file and a
  200 MiB decoded-payload ceiling for Download all ZIPs. A single-file stream
  through either included provider has a 20-second first-byte timeout, a
  30-second idle timeout, and a five-minute absolute deadline; Download all has
  a ten-minute absolute deadline. Set the proxy timeout above the longer archive
  deadline (eleven or twelve minutes is suitable). Do not add range handling:
  Veda Mail intentionally rejects partial attachment requests.
- Preserve POST and GET on the Download all archive route. Its scoped POST
  preflight returns a 30-second, single-use ticket for the native GET; proxies
  must not cache either response or log query strings. Ticket state is
  process-local and follows the existing supported single-replica boundary.
- Do not cache any application document or `/api/*`, including `/`, `/setup`,
  and `/admin`; preserve Veda Mail's private no-store response policy.
- Do not automatically retry `POST /api/v1/mail/send` with a newly generated
  body or draft key. The browser reuses one stable draft UUID and Veda Mail
  replays its terminal receipt; proxy retries must preserve the request body.
- Preserve the application's CSP and production
  `Strict-Transport-Security: max-age=31536000` headers without adding
  duplicates. Veda Mail intentionally omits `includeSubDomains` and preload;
  add either only after confirming HTTPS works for every affected subdomain.
- Do not rewrite application cookie attributes.

Production cookies are Secure, HttpOnly, SameSite=Lax, and scoped to the
application host.

### Forwarded client addresses

Keep:

```dotenv
VEDA_MAIL_TRUST_PROXY_HEADERS=false
```

unless all direct access to the app is blocked and the trusted proxy replaces
untrusted forwarding headers. Only then set it to `true`. Incorrectly trusting
these headers weakens login rate limiting. With the default `false` setting,
low limits are isolated by hashed account or verified session identifiers;
separate, higher global caps still protect the process without placing every
member in one shared low-limit bucket.

## Network policy

Inbound:

- Reverse proxy to Veda Mail TCP `3000`
- Administrators and members to the reverse proxy TCP `443`

Outbound:

- DNS resolution
- HTTPS TCP `443` to explicitly allowlisted JMAP provider hosts
- TLS/STARTTLS IMAP and SMTP ports only to explicitly allowlisted provider
  hosts
- HTTPS/DNS access from ClamAV `freshclam` for signature updates

Internal only:

- Veda Mail to ClamAV TCP `3310`; never publish this port on the host

Both provider adapters reapply hostname allowlisting and public-address
resolution checks at their network boundaries to reduce DNS-rebinding risk.
Production egress policy must independently deny cloud metadata, loopback,
private management networks, and unapproved destinations. Received attachment
downloads use the existing provider connection; no inbound provider port or
Stalwart server change is required.

## Security defaults

The supplied Compose service:

- Runs as an unprivileged user
- Drops Linux capabilities
- Enables `no-new-privileges`
- Uses an init process
- Publishes only to loopback by default
- Stores durable state only under `/data`
- Has an application health check

The ClamAV sidecar has its own `clamd` health check, immutable image digest,
private-only port, `no-new-privileges`, and a dedicated signatures volume. Its
official init process currently starts as root before dropping to ClamAV
service users, so the application container's unprivileged-user/capability
claims do not apply to that sidecar.

Keep one writable replica until the mutable repositories below are replaced.
Administrator/member provider sessions, delivery notices, send idempotency,
durable job coordinators, and attachment quarantine may use the encrypted
shared Redis repository; message-list preferences, saved searches, signatures,
templates, contacts, calendar events, label catalogs, and mailbox appearance
migrate there on first access, and request limits may use their separate backend.
Scaling still requires transactional replacement for the remaining per-member
metadata stores.

Portable-label deletion needs no worker or new environment variable. Cleanup
advances in bounded authenticated requests while the member mailbox is open;
encrypted progress resumes after a restart or later sign-in. Keep the single
writable replica rule so in-flight label mutations and deletion share the same
owner/label operation queue.

## Post-deployment checks

```bash
docker compose ps
docker compose logs --tail=100 veda-mail
curl --fail https://webmail.example.com/api/health
curl --fail https://webmail.example.com/api/ready
```

Configure private metrics scraping, provider dashboards, structured-log
retention, and sustained alerts from the [observability runbook](OBSERVABILITY.md).

Verify:

- `/setup` is locked after first-run completion.
- `/admin` rejects member mailbox credentials.
- Administrator 2FA and one backup code have been tested.
- `/` accepts only allowed-domain mailbox users.
- The provider endpoint is HTTPS and on the hostname allowlist.
- A member can receive, send, archive, and delete.
- A member can save plain and rich signatures, choose new-message and
  reply/forward defaults, reload without losing them, and send the expected
  sanitized plain/HTML content through the configured provider.
- A member can create, reload, update, and delete a plain/rich template; Insert
  changes only the body at the current selection, while confirmed Replace
  changes only subject/body and preserves recipients, attachments, reply/draft
  identity, and one managed signature. Verify one resulting JMAP and one IMAP/
  SMTP draft/send through the ordinary provider path.
- A member can create and reload a multiple-address contact, create a group,
  select contact and group suggestions from To/CC/BCC by keyboard, and see only
  conclusively accepted recipients enter recent suggestions. Verify that a
  provider-rejected partial recipient and an uncertain send do not enter
  history. Export the address book, import it into a clean dedicated identity,
  and verify names, addresses, and category-derived groups through one JMAP and
  one IMAP/SMTP session.
- A member can download `veda-mail-settings.json`, select it in another
  dedicated identity, review the explicit replacement warning, and import it.
  Verify preferences reload, rules use the destination mailbox/label IDs,
  missing or ambiguous targets fail without mutation, and the security audit
  records both export and import without file contents.
- A small known-clean attachment uploads, sends, and arrives byte-identically.
- The received attachment downloads byte-identically, is not cached by the
  proxy, and is served with attachment disposition and `nosniff`.
- A multi-attachment Download all ZIP passes an independent archive integrity
  check and every extracted entry matches its source SHA-256 digest.
- Forwarding that received attachment shows copy/scan progress, sends only
  after the import is clean, and arrives byte-identically without a provider
  blob or MIME-part locator appearing in browser request data.
- A small plain-text received attachment previews only after a clean ClamAV
  verdict; the response is no-store/no-transform `text/plain`, the frame has
  `sandbox="allow-same-origin"` without scripts, and SVG/HTML/PDF/image
  attachments show Download without raw Preview.
- For both JMAP and IMAP, a known-clean JPEG/PNG/WebP referenced by a unique CID
  renders from a `blob:` URL only after a clean scan and WebP normalization.
  Also verify one JMAP sequential image body part without a CID renders through
  the same path while unsupported media remains an attachment fallback.
  Confirm remote images remain blocked, the message frame omits
  `allow-same-origin`, and its CSP has `img-src blob:` with no child network
  access. This requires no Stalwart configuration change.
- An EICAR test file is rejected in a dedicated non-production mailbox test.
- A container restart signs members out but preserves configuration.

## Maintenance

Before upgrades:

1. Back up `/data`.
2. Record the running image or commit.
3. Read [CHANGELOG.md](../CHANGELOG.md).
4. Follow [the upgrade guide](UPGRADING.md).

For restoration and administrator-access limitations, read
[backup and recovery](BACKUP-AND-RECOVERY.md).
Before promotion, complete the [release checklist](RELEASE-CHECKLIST.md) and
review the deployment-specific [privacy lifecycle](PRIVACY.md).
