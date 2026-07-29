# Upgrading Veda Mail

Use tagged releases or pinned commit hashes in production. Do not deploy a
moving branch without reviewing its changes.

## Before an upgrade

1. Read [CHANGELOG.md](../CHANGELOG.md) and the release notes.
2. Back up and verify the complete `/data` volume.
3. Record the current image tag or commit for rollback.
4. Run the new version in staging against a dedicated test mailbox.
5. Confirm Node.js, Docker, and reverse-proxy requirements.

## Compose upgrade

For a source checkout:

```bash
git fetch --tags
git checkout <release-tag>
./scripts/check-clamav-platform.sh
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 veda-mail
```

For a published image, update the pinned image tag and run:

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
