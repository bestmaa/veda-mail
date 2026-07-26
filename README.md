# Veda Mail

White-label, provider-independent webmail for organizations. Deploy one
instance, complete a protected first-run wizard, connect the organization's
mail server, and let members sign in with their existing mailbox credentials.

Veda Mail is built with Next.js, React, strict TypeScript, and a server-side
provider adapter boundary. Stalwart JMAP and standard IMAP/SMTP are included.

> Veda Mail is a webmail client, not an SMTP/IMAP server. Create domains and
> mailboxes in Stalwart (or another supported provider) before users sign in.

## Highlights

- One-time `/setup` wizard protected by an installation token
- Separate administrator account and member mailbox authentication
- Administrator authenticator-app 2FA with one-time backup codes
- Provider-independent member authenticator 2FA with backup codes
- Organization name, product name, logo, colors, and repository link
- Allowed-domain controls and a protected provider configuration
- Inbox, reader, search, compose, reply, star, archive, and delete flows
- Sanitized HTML mail; scripts and remote images are removed
- Opaque HttpOnly cookies; mailbox passwords never enter browser storage
- Pure prop-driven views, connectors, hooks, and ports/adapters
- Strict TypeScript, architecture checks, and a 250-line source limit
- Docker, Compose, reverse-proxy, and Dockploy support

## Published container image

The signed multi-platform image supports `linux/amd64` and `linux/arm64`:

```bash
docker pull ghcr.io/bestmaa/veda-mail:latest
```

`latest` tracks the default branch. Every publication also receives a
`sha-<commit>` tag. A `vX.Y.Z` Git tag additionally publishes `X.Y.Z` and
`X.Y` image tags. Pin a release tag or digest for production.

## Quick start with Docker Compose

Requirements: Docker Engine with Compose v2 and a supported JMAP or secure
IMAP/SMTP mail server.

```bash
git clone https://github.com/bestmaa/veda-mail.git
cd veda-mail
cp .env.example .env
openssl rand -hex 32
```

If OpenSSL is unavailable, generate it with Docker:

```bash
docker run --rm node:24-alpine node -e \
  "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

In `.env`, set the generated `VEDA_MAIL_SETUP_TOKEN`, every provider hostname,
and the public Veda Mail URL:

```dotenv
VEDA_MAIL_SETUP_TOKEN=your-64-character-generated-value
VEDA_MAIL_ADMIN_RECOVERY_TOKEN=a-different-64-character-generated-value
VEDA_MAIL_ALLOWED_PROVIDER_HOSTS=mail.example.com
VEDA_MAIL_PUBLIC_URL=https://webmail.example.com
```

Provider allowlist entries are hostnames only—no scheme, path, or port. Then:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

The Compose file uses `ghcr.io/bestmaa/veda-mail:latest` by default. To build
the checked-out source instead, run `docker compose up --build -d`.

Open <http://127.0.0.1:3000/setup>. For any public deployment, configure HTTPS
before completing the wizard.

### First-run wizard

Enter:

1. The setup token from `.env`.
2. A unique administrator username and strong administrator password.
3. Organization and product names.
4. Primary/accent colors and, optionally, a logo.
5. Optionally, the public repository URL shown in the branded UI.
6. Stalwart JMAP or Standard IMAP + SMTP and its public endpoints.
7. Every email domain whose members may sign in.

After completion, `/setup` is permanently locked for that data volume. Open
`/admin` for later organization and provider changes. Members use `/` and enter
only their full email address and mailbox password.

## Local development

Requirements: Node.js 24+, npm 11+, and a reachable mail provider.

```bash
npm ci
cp .env.example .env.local
npm run setup:token
```

Paste the output into `.env.local`. For local metadata and storage, also set:

```dotenv
VEDA_MAIL_DATA_DIR=./data
VEDA_MAIL_PUBLIC_URL=http://localhost:3000
```

Then:

```bash
npm run dev
```

Open <http://localhost:3000/setup>.

## Environment

Every deployment requires a setup token and data directory:

```text
VEDA_MAIL_SETUP_TOKEN=<at least 24 random characters>
VEDA_MAIL_ADMIN_RECOVERY_TOKEN=<at least 32 separate random characters>
VEDA_MAIL_DATA_DIR=/data  # containers; use ./data for local Node.js
```

Production additionally requires:

```text
VEDA_MAIL_ALLOWED_PROVIDER_HOSTS=mail.example.com
VEDA_MAIL_PUBLIC_URL=https://webmail.example.com
```

`VEDA_MAIL_PUBLIC_URL` is the browser-facing Veda Mail origin, not the mail
provider URL, and must not have a trailing slash. The supplied Compose file
uses `http://localhost:3000` only as its local default.

Keep proxy trust disabled unless the deployment meets the requirements in the
[reverse-proxy guide](docs/DEPLOYMENT.md#forwarded-client-addresses):

```text
VEDA_MAIL_TRUST_PROXY_HEADERS=false
```

The setup token is not an administrator password or recovery token. It is only proof that the
person claiming a fresh installation can read its deployment secrets. Keep it
secret even after setup; the installation lock remains authoritative.

Keep `VEDA_MAIL_ADMIN_RECOVERY_TOKEN` separate from the setup token and admin
password. It enables only the interactive container recovery command described
in the [recovery guide](docs/BACKUP-AND-RECOVERY.md#administrator-recovery);
it is never accepted by a public HTTP endpoint.

## Data and sessions

The `/data` volume contains installation state, the scrypt administrator
password hash, a random session-signing secret, organization branding, and
provider configuration. Enabled administrator and member authenticator secrets
are encrypted and backup codes are stored only as salted digests. `/data` does
not contain mailbox messages or member passwords.

Member provider credentials are process-memory only. A restart signs members
out. Run one replica unless you add a shared encrypted session repository and
distributed rate limiter.

Back up `/data` before every upgrade. See the
[backup and recovery guide](docs/BACKUP-AND-RECOVERY.md).

## Documentation

- [Installation and first-run setup](docs/INSTALLATION.md)
- [Organization administration](docs/ADMINISTRATION.md)
- [Docker, Dockploy, and reverse proxies](docs/DEPLOYMENT.md)
- [Mail server and DNS prerequisites](docs/MAIL-SERVER-SETUP.md)
- [Mail providers and compatibility](docs/PROVIDERS.md)
- [Member authenticator 2FA](docs/MEMBER-2FA.md)
- [Backup, restore, and recovery](docs/BACKUP-AND-RECOVERY.md)
- [Upgrading](docs/UPGRADING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Adding a provider](docs/ADDING-A-PROVIDER.md)
- [Open-source compliance](docs/OPEN-SOURCE-COMPLIANCE.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Verification

```bash
npm run check
npm run build
npm audit --audit-level=high
docker compose config
```

## License and trademarks

Copyright © 2026 Veda Concepts.

The source is licensed under
[GNU AGPL v3 or later](LICENSE). You may use, study, modify, and redistribute
it under that license. If you run a modified version as a network service, the
AGPL requires you to offer its corresponding source to users of that service.
Preserve applicable copyright and license notices.

The license does not grant trademark rights. Organization administrators may
white-label their own deployed interface, but public modified distributions
must not imply endorsement by Veda Concepts or present themselves as the
official Veda Mail project. See [TRADEMARKS.md](TRADEMARKS.md).
