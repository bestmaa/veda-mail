# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Encrypted, session/draft-bound attachment quarantine with safe names, exact
  byte quotas plus global capacity ceilings, magic-number MIME detection,
  ClamAV scanning, idle/absolute/verdict deadlines, scheduled expiry,
  cancel/remove, and byte-identical JMAP or IMAP/SMTP sending
- Authenticated received-attachment downloads for JMAP and IMAP, with
  message-scoped opaque identifiers, bounded streaming, and truthful provider
  capability metadata
- Server-streamed Download all archives for JMAP and IMAP, with authoritative
  metadata lookup, root-only collision-safe filenames, STORE-mode CRC-verified
  ZIP entries, byte/count/deadline limits, cancellation-safe concurrency, and
  actionable preflight failures
- Server-authoritative forwarding of original received attachments through
  bounded plaintext staging, malware scanning, MIME verification, and the
  encrypted outbound quarantine
- Official ClamAV sidecar pinned to a zero-HIGH/CRITICAL `linux/amd64` digest
  with a persistent signature database and fail-closed platform preflight
- CC and BCC composing, including CC-only and BCC-only delivery
- Reply All with identity exclusion, recipient deduplication, and
  provider-derived `In-Reply-To` and `References` headers
- Plain-text forwarding with readable original-message metadata
- Reader To/CC metadata and compose focus management
- Safe rich-text composing with semantic headings, bold/italic/underline,
  ordered and unordered lists, isolated links, undo/redo, plain-text mode, and
  browser spellcheck. The client editor uses version-pinned, MIT-licensed
  Lexical 0.44.0 and accepts pasted or dropped content as plain text only
- Provider capability matrix and public Gmail-class product roadmap
- Member-visible provider capability status with unsupported features called out
- Coverage thresholds, route/component harnesses, and Playwright browser
  regressions for desktop, mobile, keyboard focus, and WCAG checks
- Protected one-time installation wizard
- Persistent organization branding and administrator account
- Protected mail-provider and allowed-domain administration
- Member email/password login against Stalwart JMAP
- Provider-independent ports-and-adapters architecture
- Inbox, message, compose, reply, search, and mutation workflows
- Docker, Compose, Dokploy, backup, recovery, and upgrade documentation
- GNU AGPL-3.0-or-later licensing and trademark policy

### Changed

- JSON request bodies, recipient fields, and mailbox read/mutation rates are
  now bounded
- SMTP send receipts now distinguish full acceptance from partial delivery.
  Rejections are matched only to the validated submitted recipient set; an
  all-recipient rejection returns a safe generic failure without provider or
  recipient detail
- Every adapter receipt is canonicalized at runtime. Malformed or contradictory
  delivery metadata becomes a terminal `uncertain` result with local opaque
  metadata, so the composer warns against a blind resend instead of treating a
  possibly delivered message as failed
- Partial and uncertain outcomes remain in a bounded in-memory FIFO for the
  current verified connection, survive ordinary page reloads, clear with the
  session, and use an explicit overflow warning when detail is compressed.
  Process-wide limits cap storage at 128 connection buckets, 2,000 notices, and
  an estimated 8 MiB, with a defensive 12-hour expiry. If the connection-key
  cap refuses a new bucket, the already-existing verified connection record
  receives a recipient-free warning flag without adding another notice-map key
- Send requests now require a stable UUID draft identifier, canonicalized to
  lowercase at every attachment and send boundary. A
  connection-scoped SHA-256 fingerprint of the exact validated provider-bound
  intent coalesces concurrent attempts and replays terminal receipts for 30
  minutes from completion, capped by session expiry. Definitive failures
  release the reservation; bounded in-memory capacity fails closed before
  attachment or provider work
- The send API retains required `body` and adds optional `htmlBody`. When rich
  content is present, the server sanitizes and canonicalizes it, derives the
  provider-bound readable `body`, and fingerprints that canonical pair rather
  than trusting the browser fallback
- Rich sends use equivalent plain-text and HTML alternatives. SMTP emits
  `multipart/alternative`, nested inside `multipart/mixed` when attachments
  exist; JMAP uses matching `textBody`/`htmlBody` values or the equivalent
  explicit mixed body structure. Plain-only sends retain their prior shape
- Authenticated sends now charge each normalized To, CC, and BCC address
  against a 300-recipient-per-connection, one-minute budget in addition to the
  existing message-rate limit
- Stalwart JMAP now reads JSON through a 16 MiB decoded-stream cap, retains at
  most the first 100 addresses in each To, CC, BCC, From, or Reply-To list, and
  truncates oversized sender-controlled summary text before validation. It also
  caps referenced body values and final text/HTML presentations at 256,000
  characters and visibly marks clipped message content
- Original-attachment forwarding now excludes rendered or hidden inline parts
  both when the client creates import jobs and when the server independently
  authorizes each opaque attachment ID
- Dependency auditing now covers the complete production and development tree
- Runtime images pin the Node base digest and exclude unused package managers
- Provider attachment streams now reject cumulative zero-byte chunk floods
  instead of allowing a no-progress stream to retain resources

### Security

- Enforce a per-document nonce Content Security Policy, retain only the reviewed
  message-frame script hash and React style-attribute exception, and emit
  production host-only HSTS
- Keep attachment and archive `no-referrer` plus sandbox policies authoritative
  by excluding API routes from the document security-header proxy
- Keep provider attachment identifiers server-only; require opaque upload IDs,
  AES-256-GCM integrity, SHA-256 verification, dynamic provider limits, and
  strict fail-closed scan verdicts
- Force received attachments to download as non-cacheable octet streams with
  sanitized `Content-Disposition`, `nosniff`, sandbox CSP, same-origin resource
  policy, range rejection, and a 50 MiB decoded-byte ceiling
- Generate multi-attachment archives only from server-resolved opaque IDs;
  stream entries sequentially without expansion or plaintext temporary files,
  and omit the ZIP directory on any incomplete or dishonest provider stream
- Never accept provider blob IDs, IMAP part locators, filenames, MIME types, or
  sizes from the browser when forwarding originals; re-resolve each opaque
  message-scoped attachment and fail closed through the scanned quarantine
- Reject control characters in outbound header fields
- Sanitize provider-derived Message-IDs, bound reply reference chains, and
  always preserve the direct parent for standards-compliant threading
- Keep BCC recipients in the SMTP envelope and out of delivered MIME headers
- Keep provider-rejected SMTP values out of receipts unless they match an
  address the authenticated member actually submitted, and replace SMTP failure
  details before request logging
- Treat SMTP failures after an ambiguous submission boundary and JMAP failures
  after the final submission request is issued as terminal recipient-free
  uncertain outcomes, while definite pre-submission failures remain retryable
- Replace JMAP method-error descriptions, unexpected method names, and
  provider-controlled retry headers with generic diagnostics before request
  logging
- Centralize hostile-mail HTML sanitization and isolate external links in
  `noopener`/`noreferrer` tabs
- Centralize outbound HTML canonicalization before idempotency reservation or
  provider access. Allow only semantic text, headings, lists, and isolated
  `http`, `https`, or restricted `mailto` links; strip active content, remote
  media, and arbitrary styles, and reject unsafe Unicode, excessive nesting or
  nodes, and per-part or combined size overflow
- Rate-limit authenticated mail work by verified connection identifiers rather
  than caller-controlled cookies
- Add CodeQL plus Trivy source, secret, misconfiguration, container, and OS gates
- Scan both published platform variants at the exact candidate digest before
  promoting release tags
- Require an explicit, version-pinned npm install-script allowlist
- Migrate the lint toolchain to an audit-clean ESLint 10 configuration
- Replace regex-based mail HTML-to-text fallbacks with a parser-backed,
  sanitizer-first conversion path with explicit input, depth, and node limits

## [0.1.0] - 2026-07-23

### Added

- Initial public self-hosted release baseline

[Unreleased]: https://github.com/bestmaa/veda-mail/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bestmaa/veda-mail/releases/tag/v0.1.0
