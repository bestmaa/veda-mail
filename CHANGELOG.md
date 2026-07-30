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
- Dependency auditing now covers the complete production and development tree
- Runtime images pin the Node base digest and exclude unused package managers
- Provider attachment streams now reject cumulative zero-byte chunk floods
  instead of allowing a no-progress stream to retain resources

### Security

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
- Centralize hostile-mail HTML sanitization and isolate external links in
  `noopener`/`noreferrer` tabs
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
