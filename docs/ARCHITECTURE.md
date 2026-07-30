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

## Inline CID image boundary

Inline CID display is a derived rendering operation, not a relaxation of the
raw attachment download boundary. Both adapters expose only normalized
attachment metadata and opaque, message-scoped handles. JMAP binds supported
JPEG/PNG/WebP Content-IDs and ordered `htmlBody` image parts to account-scoped
blob references inside its adapter. A supported sequential image without a
Content-ID receives an internal opaque-only marker; unsupported or ambiguous
media remains an attachment fallback.
IMAP derives the same candidates from authoritative `BODYSTRUCTURE` and binds
the server-held MIME part, message UID, and `UIDVALIDITY` into its opaque
identity.

The server-side HTML sanitizer replaces only a unique, verified `cid:` match
with an opaque data marker. It removes the original source URL along with
remote, data, blob, unsupported, missing, or ambiguous image references. The
sanitizer and frame loader share an eight-image-per-message limit.

After the isolated frame loads, the browser submits an explicit authenticated,
same-origin `POST` to
`/api/v1/mail/messages/{messageId}/attachments/{attachmentId}/inline-image`.
`GET`, `HEAD`, query parameters, byte ranges, and cross-origin requests are
rejected. The browser sends no provider URL, JMAP blob ID, IMAP part locator,
filename, MIME claim, or source bytes.

The server re-resolves the current provider object under bounded download,
rate, concurrency, and deadline controls. It collects at most 5 MiB, requires
every byte to receive a clean ClamAV verdict, and requires the provider MIME
hint to agree with magic-number detection for JPEG, PNG, or WebP. Strict
container checks precede Sharp/libvips decoding. The decoder accepts only one
page within 4,096 pixels per dimension and 16 megapixels, applies orientation,
fits the output within 1,600 by 1,600 pixels without enlargement, strips
metadata, and emits WebP.

The response is private, no-store, `nosniff`, same-origin, range-disabled WebP.
The parent verifies its exact type and bounded length, transfers the Blob
through `postMessage` with a render-specific token, and creates the object URL
inside the child. The message frame has no `allow-same-origin`; its CSP allows
only `blob:` image sources and the reviewed hashed resize/message helper, with
all child network connections blocked. No Stalwart configuration change or
new provider endpoint is required.

Residual boundaries are explicit. Sharp/libvips is a native decoder running
inside the Veda Mail process under byte, pixel, dimension, time, and concurrency
limits; it is not process-isolated. Eligible transient busy or unavailable
preparation responses receive at most two abort-aware automatic retries.
Remaining failures become sanitized alt text; an accessible parent-side control
retries only failed opaque attachment IDs and remains bounded and fail-closed.

Download all uses the message-scoped static route
`/api/v1/mail/messages/{messageId}/attachments/archive`. The browser supplies
only the opaque message ID. A signal-aware gateway call authoritatively
classifies the current visible/downloadable attachments and may inspect bounded
message presentation data to apply the same sanitizer and inline-image render
cap as the reader. The existing per-attachment gateway operation then
revalidates and opens each source sequentially.

The server writes a classic ZIP stream in STORE mode with CRC-32 data
descriptors, fixed privacy-safe metadata, regular-file attributes, and one
flat, sanitized, collision-safe UTF-8 name per attachment. It never buffers a
complete archive, creates a plaintext temporary file, follows a provider path,
or expands a nested archive. The boundary allows at most 100 entries, 50 MiB
per entry, and 200 MiB of actual decoded payload under a ten-minute deadline,
four global archive leases, one lease per member, and the shared download
budget. Any cancellation, dishonest length, no-progress stream, or provider
failure stops later fetches and omits the central directory, leaving no
success-looking partial ZIP.

## Plain-text attachment preview boundary

Preview is a separate explicit `POST` to the message-nested opaque attachment
route. `GET`, `HEAD`, query parameters, byte ranges, cross-origin requests, and
all renderer values except the strict `text` contract are rejected before
provider access. The browser never submits a provider locator, MIME type,
filename, or size.

The server fetches the provider object once under the shared download budget,
a dedicated two-global/one-member preview lease, a 1 MiB input ceiling, and a
90-second composite preparation deadline. A separate 30-second absolute
response deadline releases the preview lease even if a client stops reading.
Every exact byte must be consumed by ClamAV and receive a clean verdict before
type detection or decoding. Both the normalized provider hint and magic
inspection must resolve to `text/plain`; the complete file must be fatal-valid
UTF-8 without NUL, unsafe C0/C1 controls, or bidi override/isolate controls.
Newlines are normalized before the 100,000-code point and 10,000-line ceilings
are enforced.

Only the derived inert text is returned, with a fixed filename,
`text/plain; charset=utf-8`, private no-store/no-transform caching, `nosniff`,
a sandbox CSP, same-origin resource policy, and no ranges. The client verifies
response type and length, creates a plain-text Blob, and displays it in an
iframe with `sandbox="allow-same-origin"`. Same-origin is the only sandbox
token so the parent native modal can contain keyboard focus and route Escape;
scripts, forms, popups, navigation, and active content remain disabled. The
Blob URL is revoked on close, message change, replacement, or unmount. SVG,
HTML, PDF, Office, images, media, archives, structured text, unknown binary,
malware, and ambiguous input never fall back to raw inline rendering. Image
preview requires a future network-disabled, resource-limited
decode-and-re-encode worker.

## Original attachment forwarding boundary

Forwarding never promotes a browser-supplied provider locator into an outgoing
message. For each original attachment, the browser posts only the fresh draft
ID to the message-nested opaque attachment import route. The server re-resolves
the current authenticated provider object, verifies the provider's outbound
size capability, and fetches decoded bytes under shared concurrency, absolute
deadline, and plaintext-memory budgets.

Decoded bytes are collected once into a fixed-size bounded buffer so IMAP's
unknown decoded length can be measured without a second provider fetch. The
buffer is exposed to quarantine in fixed 64 KiB views, then wiped. Only after
the exact byte count is known does the server reserve draft quota, sanitize the
provider-bound name and MIME hint, run ClamAV plus magic-number detection,
encrypt the clean result, and return a normal quarantine upload ID. Abort,
timeout, provider, quota, type, scan, or storage failure cancels the source,
removes the reservation, and releases every resource lease. A later send uses
the same claim, integrity-check, retry, and consume path as a local upload.

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
