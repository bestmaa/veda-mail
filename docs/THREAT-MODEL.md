# Veda Mail threat model

This document records the security boundaries and abuse cases that must be
reviewed before a feature is advertised as production-ready. It applies to the
web application and its provider adapters. The configured mail server remains
the system of record for messages.

## Assets

- Administrator credentials, recovery token, sessions, and authenticator
  secrets
- Optional Stalwart management API key and mailbox-provisioning authority
- Member mailbox credentials, sessions, and provider access tokens
- Message content, recipient metadata, attachments, contacts, and calendar data
- Locally stored member signature content, defaults, and revision tokens
- Organization branding, provider configuration, and allowed-domain policy
- Integrity of outbound mail, mailbox mutations, rules, and future scheduled
  work
- Availability of Veda Mail and the upstream mail provider

Mailbox passwords and provider tokens must never enter browser storage, logs,
URLs, analytics, or client-readable cookies.

## Trust boundaries

1. The browser is untrusted. Every request is authenticated, authorized,
   rate-limited where abuse is plausible, and validated again on the server.
2. Reverse-proxy headers are untrusted unless
   `VEDA_MAIL_TRUST_PROXY_HEADERS=true` is deliberately enabled behind a proxy
   that overwrites them.
3. Provider responses and inbound messages are hostile input, even when they
   came from the organization's own mail server.
4. Configured JMAP, IMAP, and SMTP endpoints cross an SSRF boundary. Production
   hosts must be explicitly allowlisted and revalidated after DNS resolution.
5. The `/data` volume and process memory are trusted only to the extent that
   host and container access controls protect them.
6. npm packages, GitHub Actions, base images, and published containers cross a
   software-supply-chain boundary.

## Threat actors

- An unauthenticated internet client probing setup, login, or public endpoints
- A member abusing their own session or attempting to access another mailbox
- A malicious sender controlling MIME, HTML, headers, filenames, and links
- A compromised or misconfigured mail provider returning hostile data
- An attacker controlling DNS or a configured provider hostname
- A dependency or build-system compromise
- An operator accidentally exposing secrets, trusting proxy headers, restoring
  stale state, or running unsupported replicas

## Current controls

### Setup, authentication, and sessions

- First-run setup requires a deployment secret and becomes permanently locked
  for the data volume after completion.
- Administrator passwords use scrypt. Authenticator secrets are encrypted and
  backup codes are stored as salted digests.
- Member provider credentials live only in server process memory. Opaque
  HttpOnly, SameSite cookies identify sessions.
- The workspace exposes a non-authenticating hash scoped to the exact
  connection. All later account-derived mail, attachment, signature,
  profile/password/2FA, and sign-out requests require it as a server-validated
  precondition, so a tab holding stale account state fails closed after another
  tab replaces the shared member cookie. Client settings and security state is
  cleared before paint on a scope change, and stale async completions are
  ignored.
- State-changing routes enforce same-origin requests and reject suspicious
  cross-site fetch metadata. Authentication and sensitive actions are
  rate-limited by request source and subject.
- Administrator recovery is an interactive container command; the recovery
  token is not accepted by an HTTP route.

Residual risk: member sessions are memory-local. A restart signs members out,
and multiple replicas do not share sessions or rate-limit state.

### Stalwart mailbox provisioning

- The management credential is a dedicated server-only API key supplied by
  the deployment environment. An independent exact-origin environment binding
  must match the active provider before any Authorization request. The key is
  never stored in the provider profile, returned to browser JavaScript, or
  included in an error.
- Operators grant only account/domain reads, account create, authentication
  read, and negative-cache invalidation. The key cannot update/destroy
  accounts, read mail, impersonate users, or authenticate to mail protocols.
- Every route requires an administrator session. Creation additionally checks
  same origin, strict request/subject rate limits, a bounded body, current
  administrator password, and configured Veda administrator 2FA.
- The browser cannot control Stalwart roles, permissions, groups, aliases,
  quotas, tenant IDs, directory IDs, or raw JMAP methods. The adapter creates
  only an ordinary `User` with inherited permissions.
- Every list/detail/create operation is scoped to the intersection of the
  active profile's allowed domains and a re-resolved enabled Stalwart domain.
  External-directory domains fail closed and must be managed at their source.
- Responses contain only bounded identity/quota metadata. Password credentials,
  API keys, roles, permissions, and groups are never requested for presentation.
- A UUID idempotency key, keyed non-secret intent fingerprint, and serialized durable
  ledger prevent duplicate creation within the supported single-replica
  deployment. A crash or indeterminate upstream mutation is reported as
  uncertain and is never blindly retried. Completed replays are explicitly
  labeled; the UI warns that the first attempt's password remains active.

Residual risk: the management key can create accounts within its Stalwart and
tenant scope. A compromised Veda process or deployment secret manager can use
that authority. Restrict key permissions, expiry, source IP, and egress;
rotate it after suspected exposure. Creation changes the upstream system of
record and cannot be rolled back by restoring Veda's `/data` volume.
The file-backed provisioning ledger is not a distributed lock; keep Veda Mail
at one replica until a shared session, rate-limit, and idempotency backend is
implemented.

### Browser response isolation

- Every application document receives a fresh cryptographic nonce and an
  enforced Content Security Policy. Executable page scripts require that nonce;
  the sandboxed message-frame styles and resize helper require their reviewed
  SHA-256 hashes.
- Documents are private and non-cacheable so a shared cache cannot reuse
  nonce-bearing HTML or disclose an authenticated mailbox representation.
- Inline script attributes, objects, media, workers, external connections, and
  framing ancestors are blocked. Nonced or reviewed-hash scripts, same-origin
  styles/fonts/API calls, same-origin or data images, sandboxed `srcdoc`, and
  reviewed blob-backed attachment and inline-image frames cover the current
  client.
- React-controlled branding and frame sizing still require inline style
  attributes. This exception is isolated with `style-src-attr`; executable
  inline script remains disallowed. Development alone permits eval and inline
  style elements for framework tooling; HMR uses the same-origin connection
  policy.
- Production responses emit host-only HSTS for one year. Subdomains and preload
  are deliberately excluded until an operator can prove HTTPS coverage for
  every related hostname.
- Attachment and archive routes are excluded from the document policy. Their
  stricter sandbox CSP and `Referrer-Policy: no-referrer` remain authoritative.

Residual risk: CSP is defense in depth, not a substitute for server-side mail
sanitization. A future external script, image, connection, worker, or frame
source requires a threat-model update and an explicit narrowly scoped policy
change. Reverse proxies must preserve exactly one CSP and HSTS value.

### Provider SSRF and credentials

- Production provider hosts require an explicit hostname allowlist.
- Provider URLs, schemes, ports, redirects, and resolved addresses are checked
  before connections are made.
- Browser responses and logs must not expose provider secrets.

Residual risk: operators can intentionally allow a dangerous hostname. Network
egress policy should still restrict the container from cloud metadata and
private management networks.

### Reading hostile mail

- HTML is sanitized on the server and rendered in a sandboxed frame.
- Scripts, event handlers, remote images, active embeds, and unsafe URLs are
  removed or blocked.
- Unique provider-verified JPEG, PNG, or WebP Content-IDs may become opaque
  inline-image markers. Eligible JMAP image body parts declared in the ordered
  `htmlBody` structure may also use a server-generated synthetic marker when
  they have no Content-ID; the marker is bound to the opaque attachment ID, and
  ambiguous or explicitly attached parts fail closed as visible attachments.
  The sanitizer removes original `cid:` URLs; remote, data, blob, unsupported,
  missing, and ambiguous images do not become renderable markers. Rendering is
  capped at eight images per message.
- Each marker is resolved through an authenticated, same-origin, POST-only
  route carrying opaque message and attachment IDs. JMAP blob IDs and IMAP
  MIME-part locators remain inside their adapters.
- Every source byte, up to 5 MiB, must receive a complete clean ClamAV verdict.
  The declared supported type must match magic-number detection, strict
  container validation, and one-page Sharp decoding within 4,096 pixels per
  dimension and 16 megapixels. The output is metadata-free WebP fitted within
  1,600 by 1,600 pixels.
- The frame receives only the verified WebP Blob through a render-scoped
  `postMessage`. Its sandbox omits `allow-same-origin`, and its child CSP permits
  only `blob:` image sources plus the reviewed helper script and styles; child
  network connections remain blocked.
- Safe links are forced into isolated `noopener`/`noreferrer` tabs so hostile
  content cannot replace the trusted message frame.
- Plain-text content is rendered as text with whitespace preserved.

Residual risk: every sanitizer change must continue to pass the shared
malicious-MIME and mutation-XSS corpus. Sharp/libvips is a native decoder in the
application process; byte, pixel, dimension, timeout, and concurrency limits
reduce exposure but do not provide process isolation. Eligible transient
429/503 inline-image responses receive at most two abort-aware automatic
retries. Remaining failures become sanitized alt text; an accessible
parent-side manual retry control retries only failed opaque attachment IDs and
remains bounded and fail-closed. Remote-content opt-in remains unimplemented.

### Composing, replying, and forwarding

- JSON bodies are bounded before buffering. Recipient fields, aggregate
  recipient count, names, addresses, subject, body, and reply identifiers have
  server-side limits.
- Recipients are deduplicated case-insensitively in To, CC, then BCC order.
- Provider-supplied Stalwart JMAP JSON is decoded through a 16 MiB stream cap.
  To, CC, BCC, From, and Reply-To arrays retain only their first 100 entries,
  while sender-controlled address, subject, and preview strings are truncated
  before validation. Malformed retained values still fail closed.
- Detailed JMAP reads request at most 256,000 bytes per body value and retain at
  most 128 referenced values within one 256,000-character source budget. Text
  and sanitized HTML presentations are independently capped at 256,000
  characters and visibly marked when clipped, preventing entity-escape or
  multi-part amplification during message opening.
- Display names, subjects, reply identifiers, and provider-derived Message-IDs
  reject control characters. Reply reference chains are deduplicated and
  bounded by count and aggregate bytes.
- Reply headers are derived from provider-owned source messages rather than
  trusted from the browser.
- SMTP BCC recipients remain in the delivery envelope and are omitted from MIME
  headers.
- Immediate SMTP rejection values are intersected case-insensitively with the
  validated submitted recipient set and deduplicated in submission order. A
  strict rejected subset produces a bounded authenticated partial-delivery
  warning; the member is told not to resend to recipients that were accepted.
- When SMTP rejects every submitted recipient, the provider error is replaced
  with a generic `MAIL_RECIPIENTS_REJECTED` response. Definite setup,
  authentication, envelope, and message failures remain retryable, while
  timeout, socket, connection, and unknown failures returned from the
  submission boundary are terminal uncertain. All are normalized without a
  recipient-bearing cause before request logging.
- Provider receipts are canonicalized independently at the HTTP boundary.
  Accepted requires no rejected values and partial requires a non-empty strict
  subset of canonical submitted addresses. Every contradictory or malformed
  result becomes terminal uncertain state with no provider-supplied recipient
  or identifier.
- Canonical partial and uncertain notices are retained only in a bounded
  connection-scoped server-memory queue. The browser fetches them through the
  authenticated API and keeps no local/session-storage copy. UUID dismissal is
  same-origin and idempotent; overflow is explicit, and connection removal or
  expiry clears recipient metadata. Per-connection and process-wide
  notice/count/estimated-byte caps bound memory. Count or byte pressure
  compresses oldest detail to a recipient-free sentinel. At the connection-key
  cap, new connection buckets are refused without changing existing buckets.
  A boolean on the already-existing verified connection record exposes a
  metadata-free warning only to that connection, without adding a notice-map
  key. The warning can reappear locally until sign-out or connection expiry.
- Every send requires a UUID draft key, canonicalized to lowercase across
  reservation, import, upload, and send boundaries. The server hashes the exact
  validated provider-bound intent and atomically reserves the connection/draft
  pair before attachment or provider work. Identical pending sends coalesce,
  terminal accepted/partial/uncertain receipts replay for 30 minutes from
  completion, and a changed intent conflicts. Definitive failures release the
  reservation; capacity exhaustion fails closed without eviction.
- The terminal receipt is stored before notice persistence or attachment
  cleanup. Full canonical rejected-recipient subsets remain bounded and are
  included in the conservative byte accounting. Pending work is capped at 64
  and 32 MiB per connection; all state is capped at 900 entries/48 MiB per
  connection and 1,024 buckets/10,000 entries/256 MiB process-wide.
- JMAP method-error descriptions, unexpected method names, and HTTP retry
  headers are never copied into request errors or logs. Definite request-level
  4xx failures remain retryable, while 408, 5xx, transport/read/parse failure,
  `serverPartialFail`, and malformed final outcomes are terminal uncertain.
  Non-OK bodies are canceled so error streams cannot retain provider sockets.

Residual risk: IMAP Sent copies currently omit original BCC metadata. Preserving
that information requires a separate private Sent representation, never a
delivered BCC header.

### Cross-tab mailbox session replacement

- The first workspace load returns a one-way scope derived from the exact
  authenticated in-memory connection. It is not the HttpOnly cookie and is not
  accepted as authentication.
- Every later account-derived workspace, message, delivery-notice, signature,
  profile, password, 2FA, sign-out, send, and attachment request must echo the
  scope. The check runs after cookie authentication and before subject-scoped
  work, body parsing, account stores, or provider access. A missing or stale
  scope returns `MAIL_SESSION_CHANGED` with HTTP 409.
- Workspace refreshes send their previously accepted scope. A tab therefore
  cannot silently adopt a different account after another tab replaces the
  shared cookie. When the workspace or message model sees HTTP 409 or an
  authenticated 401, it invalidates pending reads and clears workspace, reader,
  mailbox, and search state. The mounted model then refuses every automatic or
  manual workspace reload, preventing its scope-clearing render from silently
  bootstrapping the replacement account. A full page reload is required to
  create a fresh bootstrap model. Removing the accepted scope also resets
  composer, attachment, delivery-notice, and signature models.
- Attachment capability resets during layout whenever the session scope
  changes. A monotonically invalidated request generation prevents a delayed
  capability response for the previous account from publishing its upload
  limit under the replacement account. The SSR limit is paired with its exact
  server-derived initial scope and is reused only if the client workspace
  accepts that same scope; otherwise it clears until a scoped refresh succeeds.
- Custom-header checks protect normal requests. A native streaming ZIP
  navigation cannot add that header, so its scoped HEAD preflight returns
  control to a GET whose only accepted query parameter is the same non-auth
  scope. The response is same-origin, private, non-cacheable, sandboxed, and
  `no-referrer`; the query value grants no access without the current cookie.
- The architecture check fails if a mail route authenticates a connection but
  omits the scope guard. The same invariant covers authenticated member routes,
  preventing newly added provider or account-settings paths from silently
  bypassing this boundary.

Residual risk: browser and reverse-proxy access logs can observe the ZIP query
scope. It is intentionally non-authenticating and useful only alongside the
already authenticated current connection. Operators should still apply normal
access-log retention and redaction controls.

### Stored email signatures

- Signature ownership is derived only after member authentication from the
  current gateway account email and provider ID. Owner identity is not accepted
  from request JSON.
- Reads and writes inherit the cross-tab mailbox scope boundary above. The
  server rejects a missing or stale scope before resolving an owner, which
  prevents one tab from mislabeling another tab's newly authenticated mailbox
  data.
- The fixed `/data/member-signatures.json` store uses HMAC-SHA-256 owner keys,
  so its outer index does not disclose mailbox addresses. Each owner book is
  AES-256-GCM encrypted with an HKDF-derived key tied to the installation
  session secret and authenticated additional data tied to its owner key.
- Owner-key v2 normalizes the provider ID and email domain to lowercase but
  preserves the email local-part. Reads accept only v2. Case-collapsed
  pre-release v1 buckets are ignored and never automatically adopted, migrated,
  or deleted, preventing ambiguous data from crossing case-distinct accounts.
- Strict outer and decrypted schemas, canonical-content revalidation, and GCM
  authentication make malformed, noncanonical, swapped, or tampered records
  fail closed. Writes use a mode-0600 temporary file and atomic replacement.
- The state-changing route checks same-origin before authentication. Reads and
  writes have global request limits and verified-connection subject limits;
  reads are limited to 120 per minute and writes to 20 per 15 minutes for one
  verified connection.
- The write body is capped at 128 KiB and parsed as one strict discriminated
  operation. Each owner is limited to 20 signatures. Names are single-line,
  case-insensitively unique, and capped at 80 characters/256 UTF-8 bytes.
- Each plain or rich field is capped at 16 KiB characters and UTF-8 bytes; the
  canonical pair is capped at 32 KiB combined. Rich input is limited to 256
  elements and depth 16, passes the outbound allowlist, and has its plain
  variant derived from sanitized HTML.
- Every successful mutation rotates an opaque revision. The serialized writer
  reloads current state and requires an exact expected revision, returning a
  safe HTTP 409 conflict for stale clients. Deletion clears defaults that
  target the removed signature.
- The settings UI keeps create, mutation, and default controls disabled until
  the authoritative book loads, while the submit path separately rejects an
  absent book. A dedicated rich-editor initialization event establishes the
  baseline before ordinary change events, so the first user edit remains dirty
  and cannot be silently discarded as initialization.
- The complete composer message crosses the ordinary outbound canonicalization
  boundary again before provider submission. The feature stores no provider
  credential and requires no Stalwart-side configuration or data migration.

Residual risk: revision serialization is local to one Veda Mail process.
Sharing one writable `/data` volume across replicas can lose a valid update;
the supported deployment therefore has exactly one signature-store writer.
Backups must keep `installation.json` and `member-signatures.json` together
because the installation session secret is required for decryption.

### Availability and resource exhaustion

- Request-body, multipart, recipient, body, provider timeout, and rate limits
  bound common resource-exhaustion paths.
- Each authenticated connection may make at most 30 send attempts and charge
  300 normalized To/CC/BCC recipients per one-minute in-process window.
  Recipient cost is charged after validation and deduplication.
- Delivery-warning memory expires within 12 hours and is capped process-wide at
  128 connection buckets, 2,000 notices, and an estimated 8 MiB.
- Send retry protection is memory-local and completion-relative. A restart
  signs the member out and clears replay state; multi-replica submission needs
  a shared atomic ledger before it can preserve exactly-once provider access.
- Mailbox reads and mutations have global limits plus verified-connection
  subject limits; untrusted cookie values are never used as limiter subjects.
- The encrypted signature file is checked against a 32 MiB ceiling before and
  after reading and before atomic replacement.

Residual risk: limits are in-process. Horizontal scaling requires a distributed
limiter and encrypted shared session repository.

## Outbound rich-text boundary

- The send API requires `body` and accepts optional `htmlBody`. Both are
  untrusted input. When `htmlBody` is present, the server ignores the browser
  fallback for provider output, sanitizes and canonicalizes the HTML, and
  derives the readable plain-text `body` from that canonical result before
  idempotency reservation, attachment access, or provider submission.
- The outbound allowlist is `a`, `br`, `em`, `h1`, `h2`, `li`, `ol`, `p`,
  `strong`, `u`, and `ul`; `b` and `i` canonicalize to `strong` and `em`.
  Links retain only a canonical `href` plus forced
  `rel="noopener noreferrer"` and `target="_blank"`. Only absolute `http`,
  `https`, and restricted address-only `mailto` destinations survive.
  Credential-bearing URLs, relative/protocol-relative URLs, active content,
  forms, remote media, arbitrary styles, and event attributes cannot reach a
  provider.
- Each input and canonical output is limited to 256,000 characters and
  256,000 UTF-8 bytes. The input pair and canonical output pair each have a
  512,000-character/byte combined budget. Rich HTML is additionally limited to
  1,000 elements, nesting depth 32, and 2,048 characters/bytes per link.
  Unsafe controls, bidi controls, malformed Unicode, unreadable sanitized
  content, and overflow fail closed.
- The canonical `body` plus `htmlBody` pair is covered by the stable-draft send
  fingerprint. A changed canonical rich message cannot replay a prior send.
- The Lexical client accepts paste and drop as `text/plain` only, preventing
  source-page markup or remote elements from entering editor state. This is
  defense in depth; the server allowlist remains authoritative for custom or
  tampered clients.

## Feature gates for future work

### Rich-text extensions

- Stored signatures pass the centralized allowlist before persistence and the
  complete message passes it again before provider submission. Future
  templates, quoted HTML, and provider-backed drafts must preserve this
  boundary.
- Future draft persistence must store a canonical HTML/plain pair without
  weakening the current no-remote-media or isolated-link policy.
- Sanitizer changes must add provider MIME plus mutation-XSS regression cases
  before release.

### Attachments

- Upload reservations use random opaque IDs HMAC-bound to the authenticated
  mailbox identity, connection, session, and compose draft. Wrong-scope
  removal is enumeration-safe and cannot mutate the owner record.
- Raw uploads require exact `Content-Length` and enforce 10-file, 18 MiB
  per-file/aggregate, 36 MiB per-session, and process-wide 512 MiB/1,000-record
  quarantine limits while streaming. Empty files are rejected.
- Filenames are Unicode-normalized, traversal/control characters are removed,
  and browser MIME claims are replaced by bounded magic-number inspection.
  Unverified JSON, XML, calendar, CSV, and other textual claims downgrade to
  `text/plain`; arbitrary UTF-8 cannot retain a structured browser MIME claim.
- Plaintext is hashed while streaming and stored only as AES-256-GCM
  ciphertext in a private temporary directory. Send re-verifies the
  authentication tag, byte length, and SHA-256 digest.
- The complete stream is scanned through ClamAV `INSTREAM`. Infection,
  unavailable scanner, incomplete consumption, MIME-detector failure, and
  storage failure all fail closed before a provider receives bytes. A
  30-second no-progress budget, five-minute upload ceiling, and separate
  30-second scanner-verdict deadline prevent both slow-drip and stalled-peer
  resource retention without rejecting steadily progressing mobile uploads.
- A background sweep enforces the 30-minute TTL without user traffic, and
  bounded production-startup cleanup removes ciphertext orphaned by a prior
  process.
- Browser requests carry only quarantine IDs; JMAP blob IDs and IMAP part
  locators remain inside their provider adapter.
- Provider limits fail closed: JMAP requires the RFC-mandated nonnegative
  `maxSizeUpload`; SMTP uses authenticated EHLO `SIZE` and an optional lower
  administrator ceiling. SMTP picker limits reserve base64/MIME overhead and
  the exact composed message is checked before submission.
- Concurrent sends share an 18 MiB FIFO plaintext-memory budget with bounded
  waiters and timeout. Capacity is acquired before decrypting and released
  after provider submission or any failure.
- Received downloads require an authenticated same-origin, message-nested
  route. Attachment IDs are opaque and message-scoped; JMAP blob IDs and IMAP
  part locators remain server-only.
- Download responses are forced to `application/octet-stream` and attachment
  disposition with a sanitized bounded filename. Private no-store/no-transform
  caching, `nosniff`, sandbox CSP, same-origin resource policy, and explicit
  range rejection reduce browser content-sniffing, intermediary rewriting, and
  partial-download bypasses. The browser independently bounds received bytes,
  verifies any declared length, and revokes failed Blob download handoffs.
- Decoded output is streamed under a 50 MiB ceiling, bounded concurrency,
  cancellation, and provider timeouts. JMAP requires exact identity-encoded
  length; IMAP revalidates mailbox `UIDVALIDITY` and current `BODYSTRUCTURE`
  before resolving and streaming the server-held MIME part.
- Download all accepts only an opaque message ID and performs an authoritative,
  signal-aware provider classification that may inspect bounded message
  presentation data to match the reader's sanitizer and inline-image render
  cap. It opens at most one downloadable attachment source at a time. Generated
  ZIPs use STORE mode, CRC-32, fixed metadata, regular root files, and
  collision-safe sanitized names; they contain no source paths, comments,
  symlinks, device entries, or provider identifiers.
- Archive generation allows at most 100 entries, 50 MiB per entry, 200 MiB
  actual decoded payload, 32 zero-progress chunks per entry, and ten minutes.
  Dedicated four-global/one-member concurrency also consumes the shared
  download budget. Cancellation, no-progress chunks, size lies, truncation, or
  provider failure stops later fetches and prevents central-directory output.
- The generated outer ZIP never expands or compresses an attached archive.
  Nested archives remain byte-identical opaque files, avoiding traversal,
  decompression bombs, recursion, and server compression amplification.
- Forwarding an original attachment accepts only message-scoped opaque route
  IDs plus a fresh draft ID. The server re-fetches the current provider object,
  stages decoded bytes within the verified outbound limit and a shared
  plaintext-memory lease, wipes the staging buffer, and imports only a clean,
  MIME-verified result into encrypted quarantine.
- The composer creates forward-import jobs only for final visible attachments.
  The server independently re-lists the message's authoritative presentation
  metadata and requires the same opaque ID to have `attachment` disposition;
  rendered, hidden, stale, or tampered inline IDs fail as not found.
- Import cancellation and absolute deadlines reach the provider stream,
  scanner, and quarantine operation. Reservation cleanup is bounded and
  best-effort failures are logged without identifiers or replacement of the
  original safe error.
- Preview is never a content-disposition change on the raw download route. It
  is an explicit, same-origin, POST-only operation with a strict text renderer
  contract, 1 MiB cap, 90-second preparation deadline,
  two-global/one-member lease, and the shared provider-download budget.
- Every preview byte must receive a complete clean ClamAV verdict before magic
  inspection and whole-file decoding. Both the provider hint and detected type
  must be `text/plain`; fatal UTF-8, unsafe control/bidi, normalized-line, code
  point, and line-count checks fail closed.
- Approved text is returned under no-store/nosniff/sandbox/CORP headers and
  rendered only from a verified `text/plain` Blob inside an iframe with
  `sandbox="allow-same-origin"`. That is the only token, used so the parent
  native modal can enforce keyboard containment across the frame; scripts,
  forms, popups, and navigation stay disabled. The object URL is revoked on
  close or context change. SVG, HTML, PDF, images, Office, archives, media,
  and unknown bytes remain download-only; there is no raw-inline fallback.
- Preparation has a 90-second composite deadline and response delivery has a
  separate 30-second absolute deadline, so hung dependencies and slow clients
  cannot retain either preview lease indefinitely.

Residual risk: received attachments are hostile provider content. Direct and
Download all responses are transport-only and are not scanned, so members
should scan unexpected downloads before opening them. Forwarding and the
bounded plain-text preview and inline CID render path do pass through ClamAV,
but a clean signature verdict is defense-in-depth rather than proof of safety.
Complex preview formats and byte ranges remain unavailable. Download all has
an explicit no-expansion policy; it is not a malware verdict. ClamAV must have
enough memory for signature reloads; operator monitoring is required.

### Rules and forwarding

- Rule conditions and actions require bounded schemas and authorization.
- Prevent automatic-forward loops, external-recipient data exfiltration, and
  header injection.
- Provide dry-run output, deterministic ordering, an audit record, and a kill
  switch. Never execute arbitrary user code.

### Imports and exports

- Treat every archive, vCard, calendar file, and settings bundle as hostile.
- Bound compressed and expanded size, entry count, nesting, parsing time, and
  path names. Reject traversal and symlink entries.
- Exports require recent authentication, least-privilege scope, streaming, and
  privacy-safe audit records.

### Scheduled send, snooze, and durable jobs

- Encrypt sensitive job payloads at rest and separate encryption keys from the
  job store.
- Use idempotency keys, leases, bounded retries, dead-letter handling, and
  cancellation states.
- Test restarts, duplicate delivery, clock skew, daylight-saving transitions,
  provider outages, and partial success before production use.
- Never advertise a durable feature while work exists only in process memory.

## Logging and observability

Logs may contain opaque request, connection, provider, and error identifiers,
but never passwords, access tokens, cookies, authenticator secrets, full
message bodies, attachment bytes, or complete recipient lists. Provider errors
must be normalized before reaching members. Security events need bounded,
tamper-evident retention before an audit log is advertised.

## Supply-chain and release controls

- Lock npm dependencies, the base-image digest, and GitHub Actions; run the
  full dependency audit.
- Enforce lint, strict type checking, architecture and line limits, unit and
  provider tests, coverage thresholds, browser regressions, and a warning-free
  production build.
- Fail dependency installation when a package adds an unreviewed lifecycle
  script; approvals are version-pinned in the project manifest.
- Publish multi-platform images with SBOM and provenance.
- Run secret/misconfiguration and container/OS scans with Trivy, plus CodeQL
  static analysis, before any container candidate is promoted to release tags.
- Runtime images exclude unused package managers and must have no
  High/Critical findings at the release gate.

## Supported deployment boundary

Veda Mail currently supports one application replica. Operators must not
load-balance multiple replicas as if sessions and rate limits were shared.
Horizontal scaling is supported only after an encrypted shared session store,
distributed rate limiter, and durable job coordination are implemented and
tested.

## Review triggers

Update this document when a trust boundary, credential flow, provider
capability, parser, upload/download path, background worker, storage format,
proxy topology, or deployment-replica model changes. Security-sensitive
roadmap work cannot be checked off until its residual risks and tests are
recorded here.
