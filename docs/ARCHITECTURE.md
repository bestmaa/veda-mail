# Architecture

Veda Mail uses ports and adapters with an explicit presentation boundary.
Dependencies point inward and provider details stop at the gateway.

## Layers

| Layer                     | Responsibility                                  | May depend on       |
| ------------------------- | ----------------------------------------------- | ------------------- |
| `domain`                  | Branded IDs and normalized mail/provider models | Domain only         |
| `application`             | Mail use cases and provider contracts           | Domain              |
| `infrastructure`          | Stalwart, IMAP/SMTP, and mock adapters          | Application, domain |
| `server`                  | Admin auth, profiles, member sessions, gateways | Inner layers        |
| `transport`               | HTTP envelopes, schemas, browser client         | Domain              |
| `presentation/hooks`      | Browser state, effects, commands                | Transport           |
| `presentation/connectors` | Hooks translated into view props                | Hooks, UI types     |
| `presentation/ui`         | Pure rendering and event forwarding             | View props only     |
| `app`                     | Next pages and route-handler composition        | Server adapters     |

## Presentation flow

1. A pure view invokes a callback received through props.
2. A connector supplied the callback from a custom hook.
3. The hook calls a same-origin `/api/v1` route.
4. The route validates input and invokes the application layer.
5. A `MailGateway` talks to the configured provider.
6. Provider DTOs are normalized before leaving infrastructure.

Views do not own state, effects, fetching, or provider knowledge.

## Installation and authentication boundaries

Setup, administrator, and member trust boundaries are separate:

```text
/setup -> setup token  -> one atomic installation record
/admin -> admin cookie -> admin API -> atomic installation updates
/      -> member cookie -> mail API -> member-scoped provider gateway
```

On a fresh volume, the setup token authorizes one installation claim but is
never persisted. Setup persists a scrypt administrator hash, random 48-byte
session secret, auth version, branding, public repository link, and the
mail-provider profile in `${VEDA_MAIL_DATA_DIR}/installation.json`. The
normalized WebP logo uses a content-addressed filename under
`${VEDA_MAIL_DATA_DIR}/branding/`.

Setup also persists the selected provider, server-side settings, display name,
and allowed domains in that same atomic record. A cross-process file lock and
create-only final commit ensure concurrent setup attempts cannot replace an
existing installation. Once installation state is complete, `/setup` is
locked independently of the environment token.

A member supplies email and password. The selected `ProviderModule` combines
those credentials with the service profile, tests the connection, and creates
an opaque process-local session. Passwords are never written to the profile
file or returned to the browser.

After upstream provider authentication, the member security service checks the
provider-independent Veda TOTP overlay. Encrypted TOTP URIs and salted
one-time backup-code digests are stored atomically in
`${VEDA_MAIL_DATA_DIR}/member-security.json`. This layer protects Veda sessions
without requiring a mailbox-management API.

An admin cookie cannot read mail. A member cookie cannot change organization
or provider settings. Neither browser receives the administrator hash, signing
secret, provider credentials, or another member's mailbox credentials.

Changing the administrator account requires the current password, increments
the persisted auth version, invalidates older administrator tokens, and issues
the current administrator a replacement token.

## Provider boundary

`ProviderModule` has three responsibilities:

- Publish a manifest with `service` and `member` field scopes
- Parse persistent service configuration
- Combine service settings with member credentials

It then creates a normalized `MailGateway`. This keeps login and admin routes
free of Stalwart-specific field names.

The deterministic demo provider is registered only in development and test.
Production registries contain deployable providers only.
The included Standard IMAP + SMTP adapter covers providers that expose secure
password/app-password protocol access. OAuth-only vendors use the same
contracts through a vendor adapter.

## Attachment upload boundary

Attachment bytes never pass through JSON and provider blob identifiers never
reach the browser. The browser first reserves an opaque, 192-bit upload ID
bound to the authenticated mailbox identity, connection, session, and compose
draft. It then sends the file as one bounded raw `PUT`.

While the request streams in, the server enforces the exact declared length,
per-file/count/aggregate/session quotas plus process-wide 512 MiB/1,000-record
ceilings, hashes the plaintext, encrypts it with AES-256-GCM into a mode-0600
temporary file, and sends the same complete stream to ClamAV. A magic-number
detector replaces the browser MIME claim. Uploads have a 30-second idle and
five-minute absolute deadline; the ClamAV verdict has its own 30-second
deadline. Scanner, detector, storage, timeout, or integrity failure fails
closed.

Only a clean upload may move atomically through:

```text
reserved -> uploading -> quarantined -> clean -> claimed -> consumed
```

The send route verifies the provider capability before claiming IDs, acquires
a bounded process-wide plaintext-memory lease, atomically claims all selected
IDs, verifies the encrypted content and SHA-256 digest, and passes normalized
bytes to `MailGateway`.
Stalwart uploads those bytes through the account-scoped JMAP `uploadUrl` and
uses the resulting provider-only blob reference in `Email/set`. The IMAP/SMTP
adapter discovers the authenticated SMTP EHLO `SIZE`, applies the lower
administrator ceiling, accounts for base64/MIME overhead, builds a
standards-compliant MIME attachment, and checks the exact final message.
Provider or pre-provider failure releases the claim for a safe retry;
successful send destroys the quarantine copy and every path releases the
memory lease.

## Attachment download boundary

Received attachments cross a separate, read-only boundary. The browser opens
the authenticated same-origin route
`/api/v1/mail/messages/{messageId}/attachments/{attachmentId}`. Both IDs are
opaque, and the attachment ID is cryptographically scoped to the message;
provider blob IDs and IMAP MIME-part locators never enter a URL or browser
payload.

The route streams through `MailGateway` under a 50 MiB decoded-byte ceiling and
bounded concurrent-download budget. Every successful response is forced to
`application/octet-stream` plus an attachment-only, sanitized
`Content-Disposition`. It is private and non-cacheable and carries `nosniff`,
a sandbox CSP, and same-origin resource policy. Byte-range requests are
rejected because partial-response semantics are not implemented.

The JMAP adapter resolves the authenticated account download URL, requires
identity transfer encoding and an exact provider `Content-Length`, then checks
the streamed byte count. The IMAP adapter opens the source mailbox read-only,
revalidates `UIDVALIDITY` and `BODYSTRUCTURE`, resolves the server-held MIME
part, and keeps the IMAP connection alive only for that bounded stream. IMAP
decoded length is not reliably known before transfer, so the HTTP response
does not claim a `Content-Length`.

## Enforced invariants

- Source, test, script, and stylesheet files stay at or below 250 lines.
- UI files cannot use React state/effect hooks, fetch, or outer adapters.
- Domain and application layers cannot import outer layers.
- Provider implementation files are `server-only`.
- TypeScript uses strict optional properties, checked indexes, and unknown-safe
  catches.

Run:

```bash
npm run check:architecture
npm run check:lines
```

## Runtime model

- Installation, branding, service profile, and member 2FA are durable on
  `/data`.
- Pending attachment uploads are encrypted, process-local quarantine data with
  a 30-minute TTL; a one-minute background sweep expires them without another
  request, and production startup removes bounded orphan quarantine
  directories. They are not mailbox storage or backup content.
- Member connections and gateway credentials are memory-only for 12 hours.
- Restarting the process intentionally signs every member out.
- A multi-replica deployment needs a shared encrypted session repository and
  coordinated rate limiter behind the existing server boundary.

The browser never talks directly to a provider. Cookies are opaque, HttpOnly,
SameSite=Lax, and Secure in production. Stalwart provider origins use HTTPS,
a mandatory production hostname allowlist, DNS resolution checks, and
private-address rejection. The same policy is checked when configuration is
saved and before provider requests.
Rate-limit window keys contain keyed hashes of account, verified-session, or
trusted-source identifiers rather than their raw values.
