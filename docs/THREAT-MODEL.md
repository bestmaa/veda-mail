# Veda Mail threat model

This document records the security boundaries and abuse cases that must be
reviewed before a feature is advertised as production-ready. It applies to the
web application and its provider adapters. The configured mail server remains
the system of record for messages.

## Assets

- Administrator credentials, recovery token, sessions, and authenticator
  secrets
- Member mailbox credentials, sessions, and provider access tokens
- Message content, recipient metadata, attachments, contacts, and calendar data
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
- State-changing routes enforce same-origin requests and reject suspicious
  cross-site fetch metadata. Authentication and sensitive actions are
  rate-limited by request source and subject.
- Administrator recovery is an interactive container command; the recovery
  token is not accepted by an HTTP route.

Residual risk: member sessions are memory-local. A restart signs members out,
and multiple replicas do not share sessions or rate-limit state.

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
- Safe links are forced into isolated `noopener`/`noreferrer` tabs so hostile
  content cannot replace the trusted message frame.
- Plain-text content is rendered as text with whitespace preserved.

Residual risk: every sanitizer change must continue to pass the shared
malicious-MIME and mutation-XSS corpus. Remote-content opt-in and inline CID
handling are not implemented.

### Composing, replying, and forwarding

- JSON bodies are bounded before buffering. Recipient fields, aggregate
  recipient count, names, addresses, subject, body, and reply identifiers have
  server-side limits.
- Recipients are deduplicated case-insensitively in To, CC, then BCC order.
- Display names, subjects, reply identifiers, and provider-derived Message-IDs
  reject control characters. Reply reference chains are deduplicated and
  bounded by count and aggregate bytes.
- Reply headers are derived from provider-owned source messages rather than
  trusted from the browser.
- SMTP BCC recipients remain in the delivery envelope and are omitted from MIME
  headers.

Residual risk: IMAP Sent copies currently omit original BCC metadata. Preserving
that information requires a separate private Sent representation, never a
delivered BCC header.

### Availability and resource exhaustion

- Request-body, multipart, recipient, body, provider timeout, and rate limits
  bound common resource-exhaustion paths.
- Mailbox reads and mutations have global limits plus verified-connection
  subject limits; untrusted cookie values are never used as limiter subjects.

Residual risk: limits are in-process. Horizontal scaling requires a distributed
limiter and encrypted shared session repository.

## Feature gates for future work

### Rich text

- All outbound rich text, signatures, templates, and quoted HTML must pass the
  same centralized allowlist before storage, preview, or provider submission.
- Generate an equivalent readable plain-text part and prohibit arbitrary
  styles, active embeds, remote media, forms, scripts, and event attributes.
- Links must retain the isolated new-tab policy, and sanitizer changes must add
  provider MIME plus mutation-XSS regression cases before release.

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
  disposition with a sanitized bounded filename. Private no-store caching,
  `nosniff`, sandbox CSP, same-origin resource policy, and explicit range
  rejection reduce browser content-sniffing and partial-download bypasses.
- Decoded output is streamed under a 50 MiB ceiling, bounded concurrency,
  cancellation, and provider timeouts. JMAP requires exact identity-encoded
  length; IMAP revalidates mailbox `UIDVALIDITY` and current `BODYSTRUCTURE`
  before resolving and streaming the server-held MIME part.

Residual risk: received attachments are hostile provider content and are not
scanned by the outbound ClamAV quarantine. Operators may add an independently
reviewed inbound scanning boundary, and members should scan unexpected files
before opening them. Preview, inline CID, download-all, forwarding original
attachments, byte ranges, and explicit archive-expansion policy remain
unavailable. ClamAV must have enough memory for outbound signature reloads;
operator monitoring is required.

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
