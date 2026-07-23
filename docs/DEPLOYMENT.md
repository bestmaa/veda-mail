# Docker, Dockploy, and reverse-proxy deployment

Complete [installation prerequisites](INSTALLATION.md) first. All production
deployments require HTTPS, one durable `/data` volume, a strong setup token,
an explicit provider-host allowlist, and the correct public Veda Mail URL.

## Published GHCR image

Veda Mail publishes a signed OCI image for both `linux/amd64` and
`linux/arm64`:

```bash
docker pull ghcr.io/bestmaa/veda-mail:latest
```

The `latest` tag follows the default branch. Each build also publishes a
`sha-<commit>` tag, and version tags such as `v1.2.3` publish `1.2.3` and
`1.2`. Pin a version or digest in production:

```dotenv
VEDA_MAIL_IMAGE=ghcr.io/bestmaa/veda-mail:latest
```

Published images include an SBOM, OCI provenance, and a GitHub artifact
attestation. Anonymous pulls work once the GHCR package is public.

## Docker Compose

```bash
git clone https://github.com/bestmaa/veda-mail.git
cd veda-mail
cp .env.example .env
openssl rand -hex 32
```

Set the generated token and deployment-specific production values in `.env`:

```dotenv
VEDA_MAIL_SETUP_TOKEN=your-64-character-generated-value
VEDA_MAIL_ALLOWED_PROVIDER_HOSTS=mail.example.com
VEDA_MAIL_PUBLIC_URL=https://webmail.example.com
VEDA_MAIL_TRUST_PROXY_HEADERS=false
```

The provider allowlist contains hostnames only. The public URL is the Veda Mail
origin, uses HTTPS, and has no trailing slash. Then:

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 veda-mail
curl --fail http://127.0.0.1:3000/api/health
```

The supplied Compose file uses the published GHCR image by default. To build
the checked-out source instead, use `docker compose up --build -d`.

The default bind is `127.0.0.1:3000`. Keep it that way behind a local reverse
proxy. To bind another host port:

```dotenv
VEDA_MAIL_BIND_ADDRESS=127.0.0.1
VEDA_MAIL_PORT=3100
```

Do not expose the container directly to the internet over HTTP.

## Dockploy

1. Create a project, then create a Compose service.
2. Connect `https://github.com/bestmaa/veda-mail` or paste `compose.yaml`.
3. Add a persistent named volume mounted at `/data`.
4. Add these environment variables as secrets:

```text
VEDA_MAIL_SETUP_TOKEN=<openssl rand -hex 32>
VEDA_MAIL_DATA_DIR=/data
VEDA_MAIL_ALLOWED_PROVIDER_HOSTS=mail.example.com
VEDA_MAIL_TRUST_PROXY_HEADERS=false
VEDA_MAIL_PUBLIC_URL=https://webmail.example.com
```

5. Set the application/container port to `3000`.
6. Add the public domain, for example `webmail.example.com`.
7. Enable HTTPS and certificate issuance.
8. Deploy and wait until the health check is healthy.
9. Open `https://webmail.example.com/setup`.
10. Complete the [first-run wizard](INSTALLATION.md#the-setup-wizard).

Do not expose SMTP, IMAP, Submission, or ManageSieve ports from Veda Mail.
Those belong to the mail-server deployment, not this webmail container.
Do not set `VEDA_MAIL_PUBLIC_URL` to the Stalwart hostname; it must be the
browser-facing Veda Mail hostname configured in step 6.

## Reverse proxy

Proxy HTTPS requests to `127.0.0.1:3000` or to the Compose service on its Docker
network. Preserve the original host and HTTPS scheme. Recommended behavior:

- Redirect HTTP to HTTPS.
- Enable WebSocket/HTTP streaming support.
- Set a reasonable upload limit for organization logos.
- Do not cache `/api/*`, `/setup`, or `/admin`.
- Add HSTS only after confirming HTTPS works for the complete domain.
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
- HTTPS TCP `443` to the configured mail provider

The Stalwart JMAP adapter rejects insecure production URLs, private/loopback
targets, disallowed hostnames, and unsafe DNS resolutions.

## Security defaults

The supplied Compose service:

- Runs as an unprivileged user
- Drops Linux capabilities
- Enables `no-new-privileges`
- Uses an init process
- Publishes only to loopback by default
- Stores durable state only under `/data`
- Has an application health check

Keep one replica. Member sessions and rate limits are process-local. Scaling
requires a shared encrypted session repository and distributed limiter.

## Post-deployment checks

```bash
docker compose ps
docker compose logs --tail=100 veda-mail
curl --fail https://webmail.example.com/api/health
```

Verify:

- `/setup` is locked after first-run completion.
- `/admin` rejects member mailbox credentials.
- `/` accepts only allowed-domain mailbox users.
- The provider endpoint is HTTPS and on the hostname allowlist.
- A member can receive, send, archive, and delete.
- A container restart signs members out but preserves configuration.

## Maintenance

Before upgrades:

1. Back up `/data`.
2. Record the running image or commit.
3. Read [CHANGELOG.md](../CHANGELOG.md).
4. Follow [the upgrade guide](UPGRADING.md).

For restoration and administrator-access limitations, read
[backup and recovery](BACKUP-AND-RECOVERY.md).
