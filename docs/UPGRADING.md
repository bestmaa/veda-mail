# Upgrading Veda Mail

Use the published immutable `sha-<full-main-commit>` image tag plus its verified
OCI index or runtime-child digest in production. The project does not currently
publish GitHub Releases or version tags. Do not deploy a moving branch or the
`latest` alias without resolving and recording an immutable digest.

## Before an upgrade

1. Read [CHANGELOG.md](../CHANGELOG.md) and the release notes.
2. Back up and verify the complete `/data` volume.
3. Record the current image tag or commit for rollback.
4. Run the new version in staging against a dedicated test mailbox.
5. Confirm Node.js, Docker, and reverse-proxy requirements.

## Compose upgrade

For a source checkout:

```bash
git fetch origin main
git checkout --detach <full-protected-main-commit>
./scripts/check-clamav-platform.sh
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 veda-mail
```

For a published image, update `VEDA_MAIL_IMAGE` to the verified immutable
`sha-<full-main-commit>@sha256:<index-digest>` reference, or to a verified
architecture-specific runtime child digest, and run:

```bash
./scripts/check-clamav-platform.sh
docker compose pull
docker compose up -d
```

The secure-attachment release adds an official ClamAV sidecar and the
`clamav-signatures` named volume. Update the entire Compose definition, not
only the Veda Mail image line. First startup downloads and loads signatures,
which can take several minutes and requires substantial memory. Do not bypass
the scanner by pointing `VEDA_MAIL_CLAMAV_HOST` at an untrusted service.

The approved ClamAV digest is currently `linux/amd64`-only. Although the Veda
Mail application image also supports `linux/arm64`, secure-attachment
deployments must use an `amd64` Docker server until an official arm64 ClamAV
image passes the same zero-HIGH/CRITICAL gate. The preflight exits non-zero on
unsupported architectures rather than allowing an unscanned fallback.

Standard IMAP/SMTP profiles gain an optional `SMTP maximum message bytes`
setting. Existing profiles safely default to `0`, which requires a numeric
authenticated EHLO `SIZE` value before attachments are enabled. Enter a
documented provider ceiling only when it is authoritative for the mailbox
plan; the lower server/admin value wins.

The send API now requires `draftId` to be a stable UUID for every message, not
only messages with attachments. Update custom clients before rollout so every
retry of the same exact validated intent reuses the same UUID; a changed intent
must use a new draft UUID. UUID text is canonicalized to lowercase across
attachment and send routes. Replay protection is process-local, lasts 30
minutes from terminal completion, and is capped by the connection lifetime.
No Stalwart configuration or migration is required.

Safe rich-text compose keeps required `body` and adds optional `htmlBody` to
the send API. Custom plain-text clients can continue omitting `htmlBody`.
Custom rich clients must still provide a nonblank `body`, but Veda Mail
sanitizes and canonicalizes `htmlBody` and derives the provider-bound plain
alternative on the server. Each field is limited to 256,000 characters and
256,000 UTF-8 bytes; the combined limit is 512,000. Update any custom client
that relied on the former 1,000,000-character plain-body ceiling.

The web image now includes version-pinned, MIT-licensed Lexical 0.44.0 client
modules. No new service or environment variable is required. Rich sends use
the existing authenticated JMAP or SMTP connection, and the change requires no
Stalwart configuration, provider-profile update, `/data` migration, or mailbox
data migration.

Named email signatures add `/data/member-signatures.json` on first use. No
environment variable, provider-profile migration, mailbox migration, Stalwart
configuration, schema change, API extension, or new port is required. The file
contains encrypted owner books and must be backed up together with
`installation.json`; its keys derive from that installation's session secret.
Do not copy either file independently between installations.

Signature owner keys now lowercase only the provider ID and email domain while
preserving the email local-part. This feature was not shipped with a supported
v1 signature format, so only v2 owner buckets are accepted. Any case-collapsed
v1 bucket created by a pre-release build is ignored and is not automatically
adopted, migrated, or deleted. Recreate those pre-release signatures through the
v2 UI instead of moving encrypted buckets between owner keys.

The signature writer is process-serialized and supports exactly one Veda Mail
process for a writable `/data` volume. Do not start old and new application
versions concurrently or attach multiple replicas to the same signature file.
An older rollback image ignores the new file, but preserve the whole matching
volume so signatures return when the newer version is restored.

Then verify:

```bash
curl --fail https://webmail.example.com/api/health
docker compose ps clamav
```

Sign in to `/admin`, check branding/provider settings, and test a dedicated
member mailbox.

## Rollback

If an upgrade fails:

1. Stop the new container.
2. Review logs without changing `/data`.
3. If the release changed persistent data, restore the pre-upgrade backup.
4. Start the previously recorded image or commit.
5. Verify health and administrator/member login.

Do not run old and new versions concurrently against the same `/data` volume.

## Session impact

Deployments and restarts sign out members because provider credentials are
kept only in process memory. Warn users before planned maintenance.

## Development verification

Contributors should run:

```bash
npm ci
npm run check
npm run build
npm audit --audit-level=high
./scripts/check-clamav-platform.sh
```

The CI workflow also starts the exact Compose-pinned ClamAV digest, waits
boundedly for its Docker health check, verifies clean and EICAR scan verdicts,
tears down all sidecar resources, and scans that digest with pinned Trivy
HIGH/CRITICAL and secret gates before any release image can be published.
