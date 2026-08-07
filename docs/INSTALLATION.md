# Installation and first-run setup

This guide installs one Veda Mail instance for one organization. The instance
may allow multiple email domains, but it has one organization brand and one
active mail-provider profile.

## Before you begin

You need:

- A Linux server or development machine
- Docker Engine 26+ with Docker Compose v2, or Node.js 24+ and npm 11.16+
- A public HTTPS hostname for production, such as `webmail.example.com`
- A supported mail server with configured domains and existing users, or an
  internal-directory Stalwart server whose users will be provisioned later
- For Stalwart, a public JMAP HTTPS URL such as `mail.example.com`
- For standard hosting, public secure IMAP and SMTP hostnames
- A durable directory or Docker volume for `/data`

Review [mail-server prerequisites](MAIL-SERVER-SETUP.md) before inviting users.

## Option A: Docker Compose

```bash
git clone https://github.com/bestmaa/veda-mail.git
cd veda-mail
cp .env.example .env
```

Generate separate installation, recovery, and scheduled-job secrets. Keep all
three outputs distinct:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -base64 32
```

If OpenSSL is unavailable, use:

```bash
npm run setup:token
npm run setup:token
docker run --rm node:24-alpine node -e \
  "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the value in `.env`:

```dotenv
VEDA_MAIL_SETUP_TOKEN=your-64-character-generated-value
VEDA_MAIL_ADMIN_RECOVERY_TOKEN=a-different-64-character-generated-value
VEDA_MAIL_DATA_DIR=/data
VEDA_MAIL_JOB_KEY=your-base64-encoded-32-byte-key
VEDA_MAIL_ALLOWED_PROVIDER_HOSTS=mail.example.com
VEDA_MAIL_STALWART_MANAGEMENT_API_KEY=optional-dedicated-api-key
VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN=https://mail.example.com
VEDA_MAIL_TRUST_PROXY_HEADERS=false
VEDA_MAIL_PUBLIC_URL=https://webmail.example.com
```

`VEDA_MAIL_ALLOWED_PROVIDER_HOSTS` is required in production and contains
provider hostnames only, without schemes, paths, or ports.
When the optional management key is set, its management origin is also
required and must be the exact HTTPS origin of the configured Stalwart URL.
`VEDA_MAIL_PUBLIC_URL` is the public Veda Mail origin, not the provider URL,
and must use HTTPS without a trailing slash.
`VEDA_MAIL_JOB_KEY` is a separate 32-byte encryption root for scheduled jobs;
store it in the deployment secret manager, never in `/data`, and preserve it
across restarts and restores. Do not quote values or commit
`.env`.

Start the service:

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 veda-mail
```

This uses the published GHCR image. The release file intentionally contains no
application build section, so digest-pinned deployments cannot accidentally
retag local source. To build the checked-out source, replace the first two
commands with:

```bash
docker compose -f compose.yaml -f compose.build.yaml up --build -d
```

Compose publishes port `3000` on `127.0.0.1` by default. Open
<http://127.0.0.1:3000/setup> locally, or configure an HTTPS reverse proxy
before opening it remotely.

## Option B: local Node.js

```bash
git clone https://github.com/bestmaa/veda-mail.git
cd veda-mail
npm ci
cp .env.example .env.local
npm run setup:token
```

Set the printed value as `VEDA_MAIL_SETUP_TOKEN` in `.env.local`, then:

```dotenv
VEDA_MAIL_DATA_DIR=./data
VEDA_MAIL_PUBLIC_URL=http://localhost:3000
```

If the local app connects to a public provider, also set its hostname in
`VEDA_MAIL_ALLOWED_PROVIDER_HOSTS`. Then:

```bash
npm run dev
```

Open <http://localhost:3000/setup>.

## The setup wizard

The wizard is available only while the configured data directory has no
completed installation (`/data` in the supplied container).

### Step 1: claim the installation

Enter `VEDA_MAIL_SETUP_TOKEN`. The token must be at least 24 characters. Failed
attempts are rate-limited. Never send this token by email or chat.

### Step 2: create the administrator

Choose:

- Administrator username: separate from every mailbox address
- Administrator password: unique and stored only as a scrypt hash

The administrator account manages branding and provider configuration. It
cannot read a member's mailbox merely because it is an administrator.

### Step 3: brand the organization

Enter:

- Organization name
- Product name shown to members
- Primary and accent colors
- Optional PNG, JPEG, or WebP logo no larger than 2 MB
- Optional public repository URL

Uploaded branding is validated, resized within 512×512, converted to WebP, and
stored on the `/data` volume. Organization admins may white-label their
deployed interface. This does not transfer the Veda Mail or Veda Concepts
trademarks.

### Step 4: connect the mail service

Choose either **Stalwart JMAP** or **Standard IMAP + SMTP**.

For Stalwart JMAP, enter:

- A recognizable connection name
- The public HTTPS server URL
- One or more allowed member email domains

Example:

```text
Connection: Example Organization Mail
Server URL: https://mail.example.com
Domains:    example.com, example.org
```

The server hostname must be included in
`VEDA_MAIL_ALLOWED_PROVIDER_HOSTS`. This allowlist is required in production;
private, loopback, and insecure provider URLs are rejected.

For Standard IMAP + SMTP, enter the secure incoming and outgoing host, port,
and TLS mode published by the provider. Add both hostnames to
`VEDA_MAIL_ALLOWED_PROVIDER_HOSTS`. See the
[provider compatibility guide](PROVIDERS.md) for Hostinger, cPanel, Zoho,
Google, and Microsoft guidance.

### Step 5: finish and verify

Review the summary and finish setup. The application writes installation,
branding metadata, and provider state as one atomic record in `/data` and
locks `/setup`.

Then:

1. Sign in at `/admin` with the new administrator account.
2. Verify organization branding and provider settings.
3. Sign out of admin.
4. Open `/`.
5. Sign in with an existing mailbox's full email address and password.
6. Send a message to an external address and reply to it.
7. Open account settings, enroll member authenticator 2FA, save all backup
   codes, sign out, and verify the two-step login.

For an internal Stalwart directory, the administrator may instead open
**Mailbox users**, create a dedicated test account, and then perform steps 3–7.

## What setup does not do

Veda Mail does not create provider domains or DNS records. Its optional
Stalwart workflow creates ordinary users only after setup and only for an
already-existing allowed internal-directory domain. Other provider users are
created in their provider. Veda Mail does not migrate messages; use the mail
provider's supported migration tooling.

## Setup lock

Once completed, `/setup` cannot be claimed again merely by knowing the setup
token. Do not edit or delete `/data/installation.json` manually. Back up
`/data` immediately after setup and before every upgrade.

After setup, sign in to `/admin`, open **Security**, and enable authenticator
2FA. Save all one-time backup codes. If credentials or second factors are
lost, use the terminal-only procedure in
[backup and recovery](BACKUP-AND-RECOVERY.md#administrator-recovery).
