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
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 veda-mail
```

For a published image, update the pinned image tag and run:

```bash
docker compose pull
docker compose up -d
```

Then verify:

```bash
curl --fail https://webmail.example.com/api/health
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
```

The CI workflow runs the same quality and security gates.
