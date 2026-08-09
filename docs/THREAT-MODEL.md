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
- Member provider credentials live only in server process memory unless the
  member explicitly schedules a provider-backed draft. That bounded job copy
  is AES-256-GCM encrypted under the external `VEDA_MAIL_JOB_KEY`, is never
  logged or returned to the browser, and is deleted after confirmed delivery
  or cancellation. Opaque HttpOnly, SameSite cookies identify sessions.
- The workspace exposes a non-authenticating hash scoped to the exact
  connection. All later account-derived mail, attachment, signature,
  profile/password/2FA, and sign-out requests require it as a server-validated
  precondition, so a tab holding stale account state fails closed after another
  tab replaces the shared member cookie. Client settings and security state is
  cleared before paint on a scope change, and stale async completions are
  ignored.
- State-changing routes enforce same-origin requests and reject suspicious
  cross-site fetch metadata. Requests with neither a valid Origin nor an
  explicit same-origin/none Fetch Metadata signal fail closed. Authentication and sensitive actions are
  rate-limited by request source and subject.
- Administrator and member sessions are server-registered, individually
  inventoryable/revocable, idle-expire after 30 minutes, and have a
  non-extendable 12-hour lifetime. Browser APIs receive HMAC management handles,
  never replayable raw bearer IDs. A restart intentionally invalidates them.
- Login throttles always use process-local global, trusted-source, and
  normalized-subject windows. Operators may configure Redis for equivalent
  cross-replica atomic windows; identifiers are HMAC-pseudonymized and a
  configured unavailable backend fails login closed.
- Administrator recovery is an interactive container command; the recovery
  token is not accepted by an HTTP route.

Residual risk: sessions and non-login rate limits remain memory-local. A restart
signs administrators and members out, and multiple replicas cannot share
provider sessions. The Redis option coordinates login throttles only.

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

### Print views

- Print preparation is a same-origin POST that requires the live browser mail
  session scope and separate request/subject rate limits. Message IDs and the
  strict `message`/`conversation` choice are reparsed server-side.
- Conversation printing uses only the portable provider contract. It accepts
  at most 100 unique messages across eight pages, detects repeated cursors,
  requires the selected anchor on the returned membership, verifies every
  fetched detail ID, and runs no more than four detail reads concurrently.
- Already-sanitized provider HTML is sanitized again without any verified
  inline-image allowance. This strips scripts, forms, styles, remote media, and
  all images before the body reaches the print-only React portal.
- Printed metadata is limited to portable addressing, date, size, and inert
  attachment name/size values. Attachment bytes and links, raw headers,
  provider cursors, credentials, and account secrets are excluded. React
  escapes every non-HTML field.
- The server response is private and non-cacheable. The portal is absent from
  the interactive accessibility tree, screen CSS hides it, print CSS hides the
  application, and the native browser print dialog is invoked only after two
  rendered animation frames.

Residual risk: browser and operating-system print dialogs, preview caches, and
printer queues are outside Veda Mail's control. Members must treat printed or
exported output as sensitive data. Conversations beyond the safe bound are
explicitly marked truncated instead of triggering unbounded provider work.

### New-mail notifications

- The application never requests notification permission during page load,
  settings display, or mail refresh. Only a direct member Enable action calls
  the browser permission API, and denied/unsupported states remain usable.
- Browser notifications are disabled by default and use generic count-only
  text by default. Sender and subject require a separate explicit privacy
  choice; message previews, bodies, and attachments are never notification
  content.
- Local storage contains only a strict, size-bounded enable/content preference
  scoped to the normalized provider/account identity. It is treated as
  untrusted, rejects unknown/cross-account fields, and contains no credentials,
  messages, notification history, or permission grant.
- A granted opt-in reuses the one authenticated update loop while the tab is
  hidden. Constructor/storage failures are contained and cannot stop mailbox
  refresh or invalidate the member session.

Residual risk: operating systems and browsers may retain notification text
outside Veda Mail after display. Detailed mode therefore warns about shared or
locked screens. This release has no service worker or push subscription;
notifications require an open tab and provide no closed-browser guarantee.

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

### Mailbox cursor and stale-page isolation

- A cursor is untrusted query input even when the preceding response produced
  it. The public value is capped at 2,048 characters and carries an opaque
  provider cursor inside an HMAC-SHA-256-authenticated envelope. Its key derives
  from the installation session secret and connection ID. The signed payload
  expires after 30 minutes and binds mailbox, secret-keyed HMAC search digest,
  newest/oldest order, preview mode, fixed 50-message page size, and format
  version. Invalid, expired, or context-mismatched cursors return HTTP 409 and
  require an authoritative page-one refresh.
- The browser coalesces duplicate load-more actions. Each page captures both
  its page generation and the root workspace generation; mailbox, search,
  refresh, logout, expiry, or cross-tab session replacement invalidates the
  completion before it can commit.
- Adjacent pages are deduplicated by provider-bound immutable message ID. The
  already selected message is independent state and is not replaced by list
  append. A provider error retains prior pages and exposes an explicit retry
  instead of advancing the cursor locally.

Residual risk: signing prevents browser tampering and cross-context replay; it
does not turn the included adapters' internal position cursors into provider
snapshots. Concurrent delivery or deletion can move later results between
requests. Deduplication prevents duplicate display but cannot reconstruct a
message skipped by upstream position movement; a manual refresh restarts from
the authoritative first page. Snapshot/query-state cursors remain future
provider-capability work.

### Advanced-search grammar and mailbox scope

- Browser parsing is only feedback; the authenticated workspace route parses
  the complete query again into a typed AST. Queries are capped at 1,000
  characters, 20 terms, and 200 characters per value. Control characters,
  unknown operators, malformed quotes/dates/sizes, contradictory ranges and
  states, and repeated mailbox selectors fail before provider access.
- Provider adapters never receive the raw grammar. JMAP receives typed filter
  properties, while IMAP receives typed SEARCH objects. Repeated IMAP keys use
  bounded result-set intersection. A predicate without portable support fails
  with HTTP 422 instead of being discarded or widened.
- `in:` resolves only against mailboxes returned for the authenticated provider
  connection. Standard roles take precedence over colliding custom names;
  unknown or ambiguous custom names fail closed. The selector is removed before
  provider compilation, and the effective mailbox plus full canonical query
  remain bound into the signed page cursor.
- Recent searches exist only in mounted React state. Shareable restoration uses
  a URL fragment containing canonical search text only; session scopes,
  provider secrets, and account credentials are never written there. Account
  invalidation clears the fragment and recent list.

Residual risk: search text can itself reveal correspondents or business terms.
The fragment is not sent as an HTTP referrer, but it is visible to local browser
history, extensions, screenshots, and anyone receiving a copied link. The
authenticated API request also carries the search query in its URL, so reverse
proxy access-log retention and redaction policy should treat it as mailbox
metadata.

### Message-list preferences and previews

- Ownership is derived after authentication from the current gateway account
  email and provider ID; the request cannot supply an owner. Same-origin,
  session-scope, strict-schema, 1 KiB request-size, and independent global and
  subject rate-limit checks protect `PATCH /api/v1/mail/preferences`.
- `/data/message-list-preferences.json` uses an HMAC-derived account index and
  AES-256-GCM values. The encryption key is HKDF-derived from the installation
  session secret, and the owner index is authenticated as additional data.
  File size and owner count are bounded; writes are mode-restricted, fsynced,
  atomically renamed, and serialized within one process.
- Formatting locale is a closed canonical allowlist, while a time-zone value is
  length bounded and must be `auto` or a runtime-valid IANA identifier. Neither
  value is forwarded to JMAP or IMAP/SMTP. Older encrypted records and clients
  migrate without replacing an already stored locale or zone. Direction is
  derived from the accepted locale; the English source catalog keeps `lang=en`
  so RTL formatting cannot falsely relabel untranslated content.
- The workspace route compares browser-echoed sort/preview context with the
  persisted preference. A mismatch fails with HTTP 409 before provider data is
  accepted, while the signed cursor independently binds the same values.
- Preview-off JMAP queries omit the provider `preview` property. Preview-on
  values lose C0/C1 and bidirectional control characters, collapse whitespace,
  and are capped at 320 characters and 1,024 UTF-8 bytes. Standard IMAP does
  not fetch body/source data for summary rows and consequently returns no list
  preview in this release.

Residual risk: metadata access timing may still reveal that an authenticated
member changed preferences, and a provider can observe JMAP preview requests
when previews are enabled. Standard IMAP avoids that body-access expansion at
the cost of unavailable snippets. Locale and time zone can reveal regional
information to someone who already obtains the encrypted store and installation
secret; they are not exposed in the plaintext owner index.

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

### Stored reusable email templates

- Template ownership is derived only from the current verified provider
  connection and gateway account. Every read/write requires the exact browser
  mailbox scope; same-origin is checked before authentication for writes.
- `/data/member-templates.json` contains HMAC-indexed, independently
  AES-256-GCM-encrypted owner books under template-specific HKDF/HMAC contexts.
  Owner AAD prevents ciphertext swapping, and strict canonical parsing after
  decryption makes tampering, corruption, and unknown versions fail closed.
- Strict operations reject mass-assigned owner/provider/recipient/attachment/
  draft/schedule fields. Names and subjects reject invalid Unicode, header,
  control, and bidi characters; names are NFKC case-insensitively unique.
- Limits cover request bytes, 50 templates, per-field and combined content,
  HTML nodes/depth, a 4 MiB owner book, 10,000 owner buckets, encrypted record
  size, and a 64 MiB file. Request and verified-account rate limits constrain
  authenticated disk and CPU abuse.
- Sanitization occurs before persistence, canonicality is verified after
  decryption, and the composed message is sanitized again before provider draft
  or send. Stored v1 templates cannot contain recipients, attachments, remote
  media, provider IDs, send actions, or managed signature markers/content.
- Replace requires an explicit warning whenever current subject/body content
  exists and preserves recipients, attachments, reply context, draft identity,
  and the managed signature. Insert cannot mutate a signature crossed by a text
  selection and never changes the subject. Neither action can send mail.

Residual risk: the whole-file compare-and-write queue is process-local, so the
supported deployment has one writable Veda Mail replica. Ciphertext lengths and
access timing reveal bounded metadata. Backups must keep `installation.json`
and `member-templates.json` in the same whole-volume snapshot.

### Stored contacts and vCard exchange

- Contact ownership is derived from the verified provider ID and gateway-owned
  mailbox address after exact session-scope validation. Same-origin checks,
  bounded body reads, per-request limits, and per-connection limits precede
  every mutation or vCard import; browser-supplied owner fields are rejected.
- `/data/member-contacts.json` hides owner identities behind HMAC-SHA-256 and
  encrypts each canonical book with contact-specific HKDF-SHA-256/AES-256-GCM.
  The versioned owner key is authenticated as AAD. A wrong installation,
  swapped owner bucket, modified tag, malformed record, or noncanonical
  plaintext fails closed as an unavailable contact store.
- Exact revisions prevent stale-tab overwrite. Strict limits cover the 128 KiB
  mutation request, 64 MiB outer file, 10,000 owners, 8 MiB owner book, 2,000
  contacts, 200 groups, five emails per contact, 500 contacts per group, 500
  recent recipients, and a 100-recipient history batch. Names, labels, addresses,
  references, duplicates, and mass-assigned fields are validated before write.
- vCard input is hostile. Import caps decoded text at 1 MiB, 1,000 cards, 256
  properties per card, 8,192-byte unfolded lines, 2,048-byte values, 64
  categories, and 32 parser-level emails before the domain enforces five emails
  and performs one atomic book mutation. It rejects malformed Unicode,
  controls, newline injection, invalid escapes, encoded or URI email values,
  duplicate singleton fields, and malformed card boundaries. `PHOTO`, `LOGO`,
  `KEY`, `AGENT`, and
  `URL` are ignored without base64 decoding, URI dereference, or network access.
  Export escapes delimiters, folds UTF-8 without splitting a scalar, and returns
  a private, no-store, `nosniff` attachment.
- Recent-recipient capture runs only after conclusive provider delivery.
  Rejected addresses are excluded from a partial receipt and uncertain delivery
  records nothing. To/CC/BCC source buckets are not persisted. Storage failure
  is non-fatal after delivery, preventing contact metadata from causing a
  duplicate send; it can only reduce future autocomplete history.

Residual risk: contact names, group membership, recipient history, and vCard
content are sensitive mailbox-adjacent metadata even when encrypted. Ciphertext
length and access timing remain observable. The whole-file writer queue is
process-local, so one writable Veda Mail replica is supported. Back up
`installation.json` and `member-contacts.json` only as one protected volume
snapshot.

### Calendar invitations and local event exchange

- Calendar MIME metadata is provider-controlled and untrusted. JMAP and IMAP
  traverse at most 512 body nodes to depth 32, accept only `text/calendar`, and
  bind opaque part IDs to the authenticated account, message, and exact native
  blob or UIDVALIDITY/section identity. A response re-lists and revalidates that
  identity; the browser cannot submit native provider locators.
- Every selected part is capped at 1 MiB, streamed through the configured
  ClamAV spool, served once from the clean spool, and then parsed. The parser
  caps components, depth, properties, attendees, text, recurrence, and unfolded
  lines; requires UTF-8 iCalendar 2.0 with exactly one primary VEVENT; rejects
  controls, bidi controls, malformed escaping, binary/encoded values, duplicate
  critical fields, unsafe mailto/TZID/time/duration/RRULE data, and multiple
  events. `ATTACH`, `URL`, `TZURL`, `GEO`, and alarm content never cause DNS,
  HTTP, filesystem, or other remote access.
- Organizer identity is never described as verified. The reader compares the
  message sender and organizer address and visibly warns on mismatch. RSVP is
  available only for METHOD:REQUEST with one organizer and exactly one attendee
  matching the gateway-owned account address. METHOD:CANCEL, REPLY, and PUBLISH
  are display/import only.
- The server re-fetches and re-parses before response, constructs the recipient
  solely from ORGANIZER, and serializes a canonical one-attendee METHOD:REPLY.
  SMTP uses an iCalendar MIME alternative; JMAP uploads a bounded
  `text/calendar; method=REPLY` part. A client UUID plus the exact response
  intent enters the scoped send-idempotency ledger. An uncertain receipt is
  replayed without automatic resend when the same action is retried.
- `/data/member-calendar-events.json` uses an HMAC-SHA-256 owner index and
  calendar-specific HKDF-SHA-256/AES-256-GCM owner envelopes authenticated with
  versioned AAD. Strict schemas, a 64 MiB outer-file limit, 1,000 events per
  owner, optimistic revisions, sequence non-downgrade, mode-0600 temporary
  files, fsync, and atomic rename protect local import/remove/export. Import is
  one canonical event per atomic mutation; export is deterministic CRLF/folded
  iCalendar and never contacts CalDAV.

Residual risk: iMIP does not cryptographically prove organizer identity; users
must evaluate the mismatch warning and message-authentication context. Floating
times and incomplete third-party timezone definitions can still be ambiguous.
Response idempotency is scoped to the active in-memory mail connection, and the
whole-file event writer is process-local, so one writable application replica
is supported. Back up `installation.json` and `member-calendar-events.json` in
the same protected volume snapshot.

### Custom mailbox administration

- The mutation route accepts no owner identity. It derives the current account
  only after browser-scope verification and applies same-origin, 16 KiB body,
  request, and verified-connection rate limits before provider mutation.
- Provider state is reloaded before each operation. System-role folders cannot
  be renamed or deleted; custom deletes require permission, zero messages, and
  no children. JMAP additionally uses `ifInState` and never enables
  `onDestroyRemoveEmails`. IMAP rechecks STATUS immediately before DELETE.
- Names reject controls and unpaired Unicode, are capped at 255 UTF-8 bytes,
  and cannot contain the active IMAP hierarchy delimiter. NFKC/case-folded
  sibling collisions, cycles, depth above eight, and more than 256 custom
  mailboxes are rejected.
- Color values come from a fixed palette. The encrypted
  `/data/mailbox-appearance.json` index uses provider/email HMAC owner keys and
  AES-256-GCM owner-bound ciphertext, strict schemas, mode-0600 temporary files,
  and atomic replacement. IMAP path-ID changes migrate metadata only after the
  provider rename succeeds.

Residual risk: standard IMAP cannot condition DELETE on the immediately prior
STATUS result. A delivery in that narrow interval is controlled by the remote
server's DELETE semantics. Operators needing atomic empty-only deletion should
use the JMAP adapter. The appearance writer is process-local, so one writable
`/data` volume still requires one Veda Mail replica.

### Portable labels

- Label IDs are opaque 128-bit random values in a restricted lowercase
  keyword alphabet. The browser cannot submit raw provider keywords; strict
  single and bulk schemas accept only a catalog ID and the server resolves it
  inside the authenticated provider/email owner bucket before provider access.
- Catalog names reject controls and unpaired Unicode, normalize with NFKC, and
  are bounded by character, byte, uniqueness, and per-account capacity limits.
  Colors come from a fixed palette. The account catalog uses HMAC owner keys,
  HKDF-derived AES-256-GCM keys, owner-bound additional data, strict decrypted
  schemas, mode-0600 temporary files, fsync, and atomic replacement.
- JMAP additions are authorized against all current containing mailboxes,
  capacity-checked, conditioned on current Email state, result-confirmed, and
  retried only once after a state mismatch. IMAP additions fail closed unless
  `PERMANENTFLAGS` permits the user flag and every STORE is refetched and
  verified. Unsupported providers hide mutation controls.
- Catalog reads in the workspace fail soft so corrupt metadata cannot suppress
  mailbox access. Catalog writes and label mutations fail closed. Provider
  exceptions are converted to bounded application errors and never expose
  credentials or raw upstream responses.
- Deletion is fail-closed and resumable. Marking a record `deleting` blocks new
  applications before cleanup starts. Provider work is capped at 100 messages
  per request behind an expiring random lease; cursor and count schemas are
  bounded, stale completions are rejected, failures release or expire the
  lease, and two independently persisted empty checks are required before the
  encrypted record is replaced by a tombstone. UI confirmation states that
  messages and mailbox membership remain untouched.
- Provider cursors are canonical, HMAC-authenticated, and bound to the current
  provider/account/label credential scope. Credential rotation invalidates and
  safely restarts the idempotent sweep. A process-local owner/label queue holds
  active single and bulk applications through provider completion, preventing
  deletion from finalizing behind an already-authorized in-flight mutation.

Residual risk: the encrypted catalog writer is process-local and requires one
writable Veda Mail replica. IMAP has no account-global message identity, so a
copied message may carry an independent label flag. A remote client can race by
reapplying a raw provider keyword after final verification; the tombstoned ID
does not become a Veda label and later cleanup remains an operator concern.

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
- Bulk mutation bodies are strict and capped at 64 KiB, 100 unique opaque IDs,
  20 verified-connection batches per minute, and four concurrent provider
  calls. One client operation is capped at 2,000 loaded IDs. Responses expose
  a complete `succeeded`/conservative-`failed` partition plus an optional
  `unconfirmed` subset and suppress provider exception text; the browser
  rejects missing, duplicate, contradictory, unknown, or wrong-typed outcomes.
  One session mutation may be issued at a time, and mailbox/search/session/root
  generation changes stop unsent batches without releasing the provider-write
  lock early.
- Reversible mutations project through a session- and view-versioned ledger.
  Confirmed successes commit, definite policy failures roll back only matching
  IDs, and ambiguous transport/provider outcomes remain projected only until
  mandatory authoritative refresh. Background refreshes are rebased under the
  active projection, newer per-message intent supersedes older uncertainty,
  and stale completions cannot reopen or overwrite a different reader.
- The encrypted signature file is checked against a 32 MiB ceiling before and
  after reading and before atomic replacement.

Residual risk: limits are in-process. Horizontal scaling requires a distributed
limiter and encrypted shared session repository.

### Irreversible message deletion

- The ordinary `delete` action remains a move to Trash. The distinct
  `destroy` mutation is exposed only from Spam/Trash bulk selection and behind
  a focus-managed alert dialog whose cancel path performs no request.
- The server treats that UI restriction only as usability. It independently
  resolves the submitted source mailbox, requires its role to be Spam/Trash,
  requires `mayRemoveItems`, and reloads every message to confirm current
  membership before destruction.
- JMAP performs a minimal mailbox-membership reload, binds `Email/set/destroy` to its
  `ifInState` collection state, and rejects `notDestroyed`. IMAP decodes
  the account-bound opaque locator, opens its source mailbox, revalidates
  `UIDVALIDITY`, and only then issues UID-scoped EXPUNGE. A stale or cross-user
  locator fails before deletion.
- Destruction is intentionally not optimistic. Only server-confirmed successes
  leave selection; failures remain selected and the mailbox refreshes after at
  least one success. The operation is still irreversible at the provider and
  cannot be undone by Veda Mail.
- Empty Spam/Trash is prepare-first. The server persists a provider snapshot
  cursor before deletion, exposes only prepared operations for resume, and
  abandons an unprepared failed claim so a restart cannot silently include mail
  received after confirmation. Encrypted owner-scoped state, a 60-second random
  lease, strict cumulative progress checks, and 100-target batches bound replay
  and resource use.
- JMAP cursors include account, mailbox, cutoff, and query state. Additions
  reported by `Email/queryChanges`, an uncalculable change set, stale collection
  state, membership drift, denied removal rights, or an unverified destroy all
  fail closed. IMAP cursors include a confirmation-time upper UID and validate
  canonical mailbox identity, UIDVALIDITY, optional OBJECTID, write access, and
  UIDPLUS before targeted expunge; post-confirmation UIDs and unrelated
  pre-existing `\\Deleted` messages are never expunged.
- Cursor MAC keys are derived from the installation secret and normalized owner
  identity rather than the mailbox password, so a leaked encrypted-state cursor
  is not an offline provider-password verifier. Cursors remain server-only.

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
  complete message passes it again before provider submission. Templates and
  quoted HTML must preserve this boundary; provider-backed draft reads and
  writes already use the same canonical HTML/plain policy.
- Sanitizer changes must add provider MIME plus mutation-XSS regression cases
  before release.

### Provider-backed drafts

- Draft reads and every write remain scoped to the authenticated connection and
  mailbox session. Opaque provider IDs never grant cross-account access, and a
  non-draft or a message outside the resolved Drafts mailbox is enumeration-safe.
- Create/update/discard require same-origin requests, strict bounded schemas,
  request and mailbox rate limits, and an expected draft-specific revision.
  JMAP collection state is refreshed only as an atomic mutation precondition;
  unrelated incoming mail cannot become the browser's revision token.
- Veda reconciliation metadata uses bounded non-system JMAP keywords. These are
  advisory provider-stored values rather than private JMAP data, but they are
  not written to RFC mail headers, so compose UUIDs, fingerprints, and
  provider-internal IDs are not transmitted to recipients.
- Standard IMAP requires an explicitly writable special-use Drafts mailbox and
  UIDPLUS. Opaque IDs bind the authenticated account scope, exact mailbox, UID,
  and UIDVALIDITY. UIDPLUS is mandatory because plain EXPUNGE could otherwise
  remove unrelated messages that another client had already marked Deleted.
  Veda's bounded compose, content fingerprint, reply, and one-write recovery
  values are private headers on the stored draft MIME. SMTP submission builds a
  fresh message from verified canonical content, so those headers are not sent.
- IMAP creates and updates use append, read-back, exact MIME/fingerprint
  verification, then targeted deletion of the prior UID. An account/compose
  in-process lock serializes Veda saves and sends on the supported single
  replica, and a unique write header reconciles an APPEND response without a
  UID. A provider-normalized, oversized, foreign-header, wrong-identity, or
  ambiguous result fails closed before the old draft is removed.
- Immutable replacements preserve non-Veda keywords and additional mailbox
  membership, rebuild from a freshness read, create and verify the replacement,
  and only then destroy the old Email in a separate conditional call. Veda does
  not assume per-object JMAP `/set` outcomes are atomic. The operation marker
  binds account, old ID/revision, exact content, authenticated From, Message-ID,
  In-Reply-To, and References; multiple, mismatched, or incomplete candidates
  fail closed. Mutable old metadata is revalidated before cleanup so a
  concurrent client change is not silently lost.
- Body completeness is proven before editing. Global/per-value truncation and
  missing referenced body values block destructive save/send. The same gate
  requires a complete
  ordered and unique allowlisted header inventory, equivalent ungrouped address
  projections, valid Message-ID/reply metadata, and a depth/part-bounded
  canonical text, text/HTML, or mixed attachment MIME structure with no
  unsupported part metadata.
  The member may close the composer or explicitly discard the exact revision
  without losing unseen content.
- Draft attachment mutation accepts at most ten entries and 18 MiB of decoded
  bytes across retained and new files. New files must already have a clean
  quarantine verdict; the route claims their exact account/session/compose
  scope, holds the shared plaintext-memory lease, re-verifies ciphertext length
  and SHA-256, and consumes them only after the provider save succeeds. A
  definite failure releases the claim. The browser can retain only opaque IDs
  returned for the exact loaded provider draft, so it cannot nominate JMAP blob
  IDs, IMAP UIDs, or MIME part locators.
- JMAP stores a canonical mixed tree over verified blob references. Attachment
  intent participates in create/replacement reconciliation, and the exact
  ordered blob/name/type inventory is reloaded across immutable replacement,
  send claim, and saved-draft submission. IMAP composes ordinary canonical MIME,
  includes the attachment body in its private MIME digest, binds each opaque ID
  to account, draft, ordinal, normalized metadata and content hash, and verifies
  the decoded attachment fingerprint after APPEND before deleting an old UID.
- JMAP saved-draft send is save-first. After identity and mailbox preflights, the
  server reloads the exact immutable draft, verifies identity, content,
  revision, markers, and mailbox role, then conditionally adds a unique send
  claim. Exact account-global compose membership is rechecked after claiming
  and every reconciliation. A single ordered JMAP batch creates a fresh Email
  and submits only its successful RFC creation reference. Acceptance requires
  exact authoritative submission evidence. The implicit Drafts-to-Sent result
  is trusted only with a continuous Email-state chain; otherwise the exact
  copy is independently verified and repaired best-effort before cleanup of
  the claimed old draft. Definitive non-submission removes the unsent copy and releases the
  claim. Any issued ambiguous, partial, contradictory, or cleanup-uncertain
  outcome keeps the old draft claimed/read-only, directs the member to check
  Sent, and cannot trigger an automatic duplicate submission.
- IMAP saved-draft send reloads the immutable UID, revision, compose identity,
  exact canonical content, authenticated From, and safe MIME inventory while
  holding the same compose lock. Only a matching browser intent reaches SMTP.
  Accepted or partial delivery triggers targeted best-effort draft cleanup;
  uncertain delivery retains the draft and relies on the existing terminal
  send guard. Standard IMAP has no provider-global conditional claim, so a
  separate external client or unsupported multi-replica deployment can race
  Veda and produce a safe conflict or duplicate provider draft. It cannot make
  Veda silently rewrite unverified content, but administrators must retain the
  documented single writable application replica.

### Browser compose recovery

- Recovery is a confidentiality boundary, not a trusted mailbox database. Raw
  content is stored only in IndexedDB and is accepted only after strict schema,
  canonical-content, control-character, size, owner, scope, and expiry checks.
  Session storage contains opaque UUID pointers, never recipients or bodies.
- Records are bound to provider, account, opaque server session scope, and the
  server-issued expiry. Indexed scope discovery permits same-session recovery
  after a tab closes without weakening owner checks. At most 32 matching
  candidates are inspected and only the four newest valid records survive.
- A 3 MiB per-record ceiling, bounded expiry scans, seven-day tombstone
  retention, compare-and-swap revisions, and record/scope revocation prevent
  unbounded storage growth and stale-tab resurrection. Expired writes fail
  closed. Sign-out, server-issued expiry, and session invalidation revoke only
  the exact session scope.
- Attachment bytes, temporary upload capabilities, and source-file handles are
  never persisted in browser recovery. Recovery records only whether unsaved
  local attachments existed and requires the member to add them again; an
  attachment that completed provider autosave is restored from provider metadata.
  A durable terminal send marker contains
  only a canonical SHA-256 request fingerprint and any provider-draft revision
  binding, never a second copy of recipients, content, or upload identifiers.
- Provider autosave is serialized to one in-flight request plus one latest
  trailing save. Lost responses reconcile exact content before retry, offline
  state pauses writes, and capped backoff prevents retry storms. Provider draft
  support is not required for local recovery.
- A send intent is durable before its HTTP request. Network errors, HTTP 408,
  server errors, and an ended in-flight send session are ambiguous outcomes;
  they immediately block send/discard and expose only a Check Sent workflow.
  Reload never replays send. A permanent discard marker can replay only the
  exact confirmed provider ID and revision.
- Closing removes ordinary recovery before hiding the composer but preserves
  terminal evidence. Exact-scope revocation is broadcast to matching tabs, and
  each immediately removes cached mailbox DOM while local cleanup completes;
  unrelated or newer session scopes ignore it. Cleanup failure keeps the
  curtain in place and retry never repeats server sign-out. Because cleanup is
  session-wide across tabs, sign-out always asks for explicit confirmation.

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
- Draft saves reuse the same inspected quarantine and memory-budget path as
  direct sends. A provider save consumes selected quarantine objects only after
  verified success; failure releases them. Later draft edits use only exact
  draft-scoped opaque attachment IDs, and saved-draft send reloads the
  authoritative provider inventory instead of trusting browser metadata.
- Provider limits fail closed: JMAP requires the RFC-mandated nonnegative
  `maxSizeUpload`; SMTP uses authenticated EHLO `SIZE` and an optional lower
  administrator ceiling. SMTP picker limits reserve base64/MIME overhead and
  the exact composed message is checked before submission.
- Organization outbound policy can only narrow those provider and quarantine
  ceilings. Sanitized filename extensions are checked before reservation,
  scanner-detected MIME is checked after upload, and message bytes, count,
  file size, extension, and MIME are revalidated for draft save and every
  immediate or scheduled delivery. Block rules precede allow rules; declared
  MIME is never authoritative, policy changes cover saved drafts, unknown
  saved-attachment sizes fail closed, and rejected uploads are deleted.
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
  cancellation, and provider timeouts. JMAP requires identity encoding and
  verifies exact length whenever authoritative metadata or a valid response
  length is available; an unknown-length stream remains byte-capped. IMAP
  revalidates mailbox `UIDVALIDITY` and current `BODYSTRUCTURE` before resolving
  and streaming the server-held MIME part.
- Direct and Download all delivery is fail-closed behind a separate encrypted
  received-attachment spool. The exact provider stream is length-bounded,
  SHA-256 hashed, AES-256-GCM staged, and completely consumed by ClamAV before
  the same scope-bound ciphertext may be decrypted for delivery. Provider bytes
  are never tee'd to a browser and scanner and are never re-fetched after a
  verdict. The process reserves the per-file ceiling during staging and retains
  quota accounting until ciphertext deletion succeeds.
- Download all accepts only an opaque message ID and performs an authoritative,
  signal-aware provider classification that may inspect bounded message
  presentation data to match the reader's sanitizer and inline-image render
  cap. It opens at most one downloadable attachment source at a time. Generated
  ZIPs use STORE mode, CRC-32, fixed metadata, regular root files, and
  collision-safe sanitized names; they contain no source paths, comments,
  symlinks, device entries, or provider identifiers.
- Native Download all navigation never carries the reusable member-session
  scope. A same-origin, scoped POST first issues a 256-bit ticket stored only by
  digest, bound to the current connection and message, capped globally and per
  connection, expired after 30 seconds, and consumed before binding checks so a
  wrong-message attempt also burns it. The opaque ticket is still a temporary
  bearer value, so archive responses keep `no-referrer` and no-store policies.
- Archive generation allows at most 100 entries, 50 MiB per entry, 200 MiB
  actual decoded payload, 32 zero-progress chunks per entry, and ten minutes.
  Dedicated four-global/one-member concurrency also consumes the shared
  download budget. Cancellation, no-progress chunks, size lies, truncation, or
  provider failure stops later fetches and prevents central-directory output.
- The generated outer ZIP never expands or compresses an attached archive.
  Nested archives remain byte-identical opaque files, avoiding traversal,
  decompression bombs, recursion, and server compression amplification.
- Every original archive entry is scanned before the first outer-ZIP byte is
  emitted. Repository-pinned clamd limits cap expanded scan bytes, recursion,
  contained files and scan time; encrypted or limit-exceeded input is treated
  as blocked, never as clean.
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
- Message drag data exposes no message ID, mailbox ID, subject, sender, or body:
  it contains only a random one-drag token. The corresponding intent is kept in
  memory and bound to the current authenticated session scope, mailbox/search
  view, exact source mailbox, and loaded IDs. External, replayed, cross-view,
  and cross-session drops fail closed.
- Move authorization is server-owned. Both source `mayRemoveItems` and
  destination `mayAddItems`, excluded Drafts/Sent roles, exact current source
  membership, and absent destination membership are rechecked before provider
  mutation. Browser target filtering is usability only.
- JMAP move patches only the named source and destination membership properties
  under the current Email state; unrelated mailbox membership is preserved.
  IMAP move requires native MOVE after exact mailbox/UIDVALIDITY/UID lookup.
  COPY plus plain EXPUNGE is forbidden because it could destroy unrelated
  messages carrying the Deleted flag. Ambiguous provider failures remain
  selected and require authoritative refresh before a user retries.

Residual risk: a clean signature verdict is defense-in-depth, not proof that a
file is harmless. Members should still treat unexpected attachments cautiously.
Direct, Download all, forwarding, plain-text preview and inline CID rendering
now fail closed behind ClamAV, while complex preview formats and byte ranges
remain unavailable. Download all never expands nested archives in the Veda Mail
process. ClamAV still requires current signatures, sufficient reload memory and
operator monitoring.

### Rules and forwarding

- Mail rules are compiled to provider-native Sieve; Veda Mail never polls an
  inbox or executes arbitrary user code. Stalwart uses RFC 9661 JMAP Sieve and
  Standard IMAP uses RFC 5804 ManageSieve only when a TLS or STARTTLS endpoint
  is explicitly configured. There is no cleartext ManageSieve fallback.
- ManageSieve resolves and pins one public provider address before connecting,
  validates the TLS hostname and certificate, bounds lines, literals, commands,
  and aggregate responses, and preserves socket timeout failures. A rejected
  greeting, failed STARTTLS upgrade, failed post-TLS discovery, or parser error
  destroys the setup socket; a partially initialized plaintext connection is
  never returned to the provider adapter.
- The route accepts at most 50 ordered rules, ten conditions per rule, and
  eight actions per rule. Strict schemas normalize NFKC, reject control and
  bidi characters, enforce header-token syntax and byte limits, and reject
  duplicate conditions/actions, multiple terminal actions, or a terminal
  action that would allow later rules to continue.
- One deterministic `Veda Mail Rules` script is protected by an
  installation-key HMAC over its exact canonical body. Veda Mail downloads and
  verifies that marker before updating. A foreign script with the same name,
  any foreign active/vacation script, ambiguous script state, unsupported
  extension, or provider-state mismatch fails closed without deactivation or
  overwrite.
- Stalwart deployment uploads a bounded script, validates it, uses provider
  state compare-and-swap for create/update plus activation, and post-verifies
  the exact blob and active script. A retry after a lost activation response is
  accepted only when the exact HMAC-owned desired script is already active.
- Desired rules, deployment status, and a redacted 500-entry control-plane
  audit are owner-isolated in `/data/member-rules.json`. The file uses
  AES-256-GCM and an HMAC owner index under a Rules-specific HKDF namespace of
  `VEDA_MAIL_JOB_KEY`, mode-0600 atomic replacement, a 64-MiB ceiling, and a
  10,000-owner ceiling. Provider credentials exist in that ciphertext only
  during a committed deployment intent and are erased on every final outcome;
  there is no background credential-bearing retry worker.
- Dry-run is read-only, capped at 100 messages, returns only bounded message
  facts and planned actions, and rejects a condition when the provider cannot
  expose the exact fact. In particular, an SMTP envelope-recipient condition
  is never approximated from visible To/Cc/Bcc headers.
- Rule routes require the authenticated mailbox session scope; writes require
  same origin, optimistic revision, subject/request rate limits, and bounded
  JSON. Browser capability filtering is usability only; the compiler and
  provider adapter enforce capabilities again.
- External redirect/forward and body/regex rules are deliberately absent from
  v1, preventing automatic-forward loops and a new data-exfiltration surface.

### Imports and exports

- Treat every archive, vCard, calendar file, and settings bundle as hostile.
- Bound compressed and expanded size, entry count, nesting, parsing time, and
  path names. Reject traversal and symlink entries.
- Exports require recent authentication, least-privilege scope, streaming, and
  privacy-safe audit records.

### Scheduled send, snooze, and durable jobs

- Undo Send is a short durable scheduling window, not a provider recall. The
  browser may cancel only while the encrypted job remains pending; a committed
  `sending` lease or already-removed accepted job returns an actionable
  too-late error and never reopens a misleading editable copy as if delivery
  had been stopped.
- Enabling Undo Send forces an exact provider-draft save before queue admission.
  A successful atomic cancellation reopens only that authenticated owner's
  opaque provider draft. A single-flight composer guard prevents double-click
  and repeated-Enter races from creating parallel jobs or submissions.
- Scheduled send encrypts the complete canonical request and provider
  connection with AES-256-GCM. HKDF-separated owner-index, payload, and key-check
  subkeys derive from an external 32-byte `VEDA_MAIL_JOB_KEY`; the atomic
  mode-0600 store contains no plaintext sender, recipient, subject, body, token,
  or password. A keyed verifier makes wrong-key restores fail closed instead of
  silently hiding jobs.
- Scheduling requires an exact-revision provider-backed draft, so attachment
  bytes remain provider-durable and are not copied into the queue. Owner and
  draft uniqueness, a 100-job owner limit, a 10,000-owner/64-MiB store ceiling,
  strict canonical schemas, same-origin writes, mailbox-session scope, and rate
  limits bound abuse.
- One durable `sending` lease is committed before provider I/O. Confirmed
  acceptance removes the job; definite failures dead-letter it; transient
  failures receive at most six attempts with bounded backoff. An ambiguous
  provider result or process restart during provider I/O becomes `uncertain`
  and is never retried automatically, preventing a portable SMTP/JMAP duplicate.
  Members must check Sent before removing that review record.
- UTC instants back the queue while the browser explicitly displays its IANA
  time zone. Invalid normalized wall-clock times, past times, and times beyond
  366 days fail validation. Automated tests cover key mismatch, restart,
  duplicate draft admission, cancellation races, retry exhaustion, provider
  uncertainty, strict routes, time conversion, and accessible management UI.
- Undo-purpose jobs accept only a 1-to-30-second server-side interval (the UI
  exposes 5/10/20/30 seconds). A missing or wrong deployment key, failed draft
  save, queue-capacity error, stale draft revision, or session change fails
  closed rather than falling back to immediate delivery.
- The current worker inherits the documented single-replica deployment boundary.
  Multi-replica scheduling remains unsupported until a shared transactional
  store and distributed lease are implemented.
- Snooze uses a separate encrypted store and HKDF namespace. Its mailbox intent
  and recovery marker are durable before mutation. Its owner index includes a
  stable provider host/account scope, so identical usernames on different mail
  servers remain isolated. Since moves are inspectable, interrupted hide/wake
  leases retry and never inherit delivery `uncertain`.
- Snooze erases its provider connection after completion, manual move, deletion,
  authentication failure, or terminal failure. Retrying a terminal record needs
  a current authenticated mailbox session.
- Never advertise a durable feature while work exists only in process memory.

## Keyboard shortcut and focus threats

Single-key commands can otherwise mutate mail while a member is typing, let a
background modal receive unintended actions, or bypass the affordance and
confirmation policy of visible controls. Veda Mail therefore keeps shortcuts
off for migrated and new accounts until the member opts in. The listener
rejects editable descendants, rich composition, open modals, modifier keys,
repeats, and already-consumed events. It invokes only the same rights-aware
view-model actions as visible buttons; permanent deletion is deliberately not
assigned a global key.

The shortcut guide is reachable by a labelled button even while shortcuts are
off. It traps focus and makes the inert application unavailable to assistive
technology. Reader transitions focus a programmatic subject heading only after
loading and return to the exact list trigger when possible. Tests cover editor
suppression, modal suppression, focus containment/return, safe unavailable
actions, preference migration, strict writes, live announcements, and automated
serious/critical accessibility scans.

## Conversation and threading threats

A browser-controlled thread ID, Message-ID, References value, mailbox, or
numeric offset could otherwise enumerate another account's mail or amplify
provider work. The route accepts none of those values. It resolves an
authenticated opaque anchor, fixes its page size, and wraps the provider
position plus ordered-membership hash in an expiring HMAC cursor bound to the
connection and anchor. A provider change between pages fails closed instead of
shifting an offset. Cursor payloads contain no provider thread or message-header value.

JMAP response account IDs, method partitions, exact Thread membership, and
anchor membership are validated before results are returned. On IMAP, scoped
mailbox/UID/UIDVALIDITY identities remain authoritative. Header-search hits are
treated as substring-prone candidates and must pass an exact bounded header
intersection after fetch. Missing or malformed IDs do not create membership,
and subject similarity is never evidence of a conversation.

Reference cycles and attacker-authored fan-out are bounded by 32 readable
mailboxes, 64 graph identifiers, four identifier-search batches, 100 verified
messages, 25 returned messages per page, a 64-KiB accepted reply-header literal,
and 30 conversation reads per account per minute. Exact provider identities are
de-duplicated and provider errors are normalized before reaching members.
Tests cover forged/stale cursors, cross-anchor reuse, false-positive header
searches, duplicate IDs, cycles, missing identifiers, provider mismatches, and
the display boundary.

Reader details expose only normalized address/date/size/attachment fields and
the position inside the already authorized loaded conversation. They never
render raw headers, protocol identifiers, provider errors, or HTML, preventing
header-driven markup injection and internal-identifier disclosure. The native
disclosure does not trigger another provider read.

Quote collapsing never weakens the message-body trust boundary or destroys
evidence. Plain-text marker recognition is bounded and conservative; HTML quote
detection runs only on server-sanitized content. Both collapsed and expanded
HTML revisions retain the same no-network CSP, sandbox, referrer policy, inline
style prohibition, bounded authenticated inline-image bridge, and exact
render-ID event checks. A hidden quote is a visual convenience, not a security
filter, and can always be revealed.

## PWA installation and offline-cache threats

A service worker can outlive a session and turn any cached authenticated
response into durable browser storage. Veda Mail therefore treats Cache Storage
as untrusted persistence and uses an exact four-path allowlist containing only
the generic offline document, its stylesheet, and public install icons. The
worker has no dynamic cache-write path; it ignores cross-origin and non-GET
traffic and never intercepts APIs, authenticated HTML, messages, attachments,
or application chunks. Navigations are network-first and receive the generic
document only when the network fails.

Cache cleanup is namespace-bounded: activation removes stale
`veda-mail-offline-` versions but cannot delete unrelated origin caches. The
worker script is served with `no-store`, and CSP permits manifests and workers
only from the same origin. The fallback has no scripts, account identity, or
mail content, preventing stale private data from being displayed after sign-out
or to another OS user. Residual browser/OS cache inspection can reveal that
Veda Mail was installed and its public branding, but no mailbox data. Automated
tests inspect the exact cache inventory and prove a real production offline
navigation while the network is disabled.

## Connectivity, stale-state, and retry threats

`navigator.onLine` and browser online/offline events are attacker-influenced
hints and cannot establish provider reachability, authentication, or message
freshness. Veda Mail uses them only to label the current authorized snapshot
and schedule an authoritative scoped workspace read. Successful provider data
is the only signal that clears stale state. A transient update-channel failure
marks the view stale and requires a reconciliation before another long wait,
closing the event gap that could otherwise hide new mail after reconnection.

Repeated events or user clicks could amplify provider traffic. Connectivity
reconciliation is therefore single-flight, existing provider-wait backoff stays
capped, and the visible Retry control performs only the same idempotent read.
No send, draft, mutation, attachment, rule, scheduled job, or destructive
operation is automatically replayed. Existing snapshots remain visible only
for refreshes of the exact current mailbox/search view; an initial load or view
change failure uses its ordinary error boundary so content from another view is
not mislabeled. Session-scope failures bypass stale recovery, clear account
state, and retain the privacy curtain. Status and alert semantics expose
offline, checking, stale, and restored phases without storing connectivity or
mail data in browser persistence.

## Logging and observability

Logs may contain opaque request, connection, provider, and error identifiers,
but never passwords, access tokens, cookies, authenticator secrets, full
message bodies, attachment bytes, or complete recipient lists. Provider errors
must be normalized before reaching members.

The separate security audit store retains at most 10,000 strict metadata-only
events. Actor and target identities are keyed pseudonyms; raw addresses,
usernames, provider IDs, message/mailbox IDs, content, IP addresses, and user
agents are excluded. Protected mutations durably record an attempt before the
side effect, then success, failure, or partial settlement. HMAC-chained entries,
a whole-file MAC, key check, monotonic sequence, mode-0600 atomic replacement,
and verification on every read detect modification, truncation, and wrong-key
restores. A valid older whole-file rollback cannot be detected without an
external checkpoint, so operators preserve off-host generations and checksums.
The file writer remains inside the documented single-replica boundary.

## Administrative capability-policy threats

A forged browser request could otherwise disable account recovery controls, a
modified client could ignore a disabled switch, or a capability table could
claim that an unsupported provider operation is available. Capability-policy
writes therefore require the HttpOnly administrator session, exact same-origin
mutation validation, strict bounded JSON, and both request- and
administrator-subject rate limits. Unknown keys and non-boolean values fail
before persistence. The server builds the matrix from the registered provider
manifest; organization policy is intersected with provider support and can
never expand it.

Member UI state is advisory. Exact mailbox-session scope is established before
policy evaluation, and the profile, password, and both 2FA-enrollment mutation
routes enforce policy again before request-body parsing or provider work. The
2FA disable route deliberately remains available when new enrollment is
disabled, preventing an organization policy change from trapping a member in
an authenticator configuration. Existing enabled 2FA remains visible for that
purpose.

Concurrent writes, truncated files, or rollback could otherwise create an
ambiguous policy. The separate record is strict and versioned, written mode
0600 through a process-serialized temporary file and atomic rename. Missing
state uses explicit enabled compatibility defaults; malformed state fails
closed as an application error rather than being silently repaired. Keeping
policy outside strict `installation.json` lets older releases ignore it during
rollback. The existing one-writable-replica boundary still applies. A host
administrator with `/data` write access remains trusted and can change policy;
these controls do not restrict direct IMAP, SMTP, provider webmail, or provider
administration outside Veda Mail.

## Vacation-response and delegation threats

Automatic replies can disclose absence windows, amplify mail loops, or be
silently overwritten by a concurrent client. Veda Mail therefore delegates
delivery semantics to the provider's standard JMAP VacationResponse object and
only enables the UI when both the server and writable primary mail account
advertise the RFC 8621 capability. Updates carry the exact provider state with
`ifInState`; stale or rejected mutations fail closed. Dates must be canonical
UTC values with an ordered window, text and subject sizes are bounded, unknown
fields are rejected, and an enabled response requires explicit message content.

Reads and writes require the exact HttpOnly mailbox-session scope. Writes also
require same-origin validation, request and subject rate limits, a bounded JSON
body, and metadata-only audit settlement. Provider errors are normalized and
raw content is never written to the audit log. HTML automatic replies are not
authored by the current UI; the adapter preserves a bounded provider value but
the UI writes plaintext with `htmlBody: null`.

Veda Mail does not claim mail delegation merely because a provider supports
calendar, address-book, or file sharing. Delegation remains visibly unavailable
until a provider advertises a reviewed mail-delegation contract. Generic
ManageSieve vacation is also fail-closed for now: installing a second active
script could disable the signed Veda rules program. It requires one ownership-
verified composed script and conflict-safe deployment before it may be exposed.

## Observability and diagnostic data

Logs and metrics are a confidentiality and availability boundary. Arbitrary
objects, exception messages, provider payloads, URLs with query strings, and
user-controlled labels can leak credentials or mailbox data and can exhaust a
collector through unbounded cardinality. Veda Mail therefore emits only
allowlisted structured fields, reduces errors to bounded class names, and uses
compiled provider and operation names as metric labels. Mailbox, account,
message, draft, attachment, recipient, connection, session, and request IDs are
never metric labels. Request IDs appear only in logs and response headers after
strict length and character validation.

The Prometheus endpoint is disabled unless an independent server-side bearer
token is configured. It is non-cacheable and the token must remain in a secret
manager and scraper, never in browser code. Readiness returns only `data` and
`scanner` states; dependency paths, hosts, and errors are suppressed. Scanner
or data failure returns 503 and cannot be misreported as ready. Liveness avoids
dependency checks so signature loading or a provider outage does not create a
container restart loop.

Counters are process-local and reset on restart. They are operational hints,
not an audit ledger or billing source. Operators remain responsible for log
access control, encryption, bounded retention, reverse-proxy redaction, metric
token rotation, per-replica scraping, and alert thresholds. The supported
single-writable-replica boundary is unchanged.

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
