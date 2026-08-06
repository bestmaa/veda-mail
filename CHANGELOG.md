# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Patched transitive `brace-expansion` and `postcss` releases after newly
  published denial-of-service and source-map path disclosure advisories, and
  pinned the safe versions through npm overrides
- Successful Stalwart 0.16 submissions no longer show an uncertain-delivery
  warning solely because `EmailSubmission/set` omits its `oldState` echo. The
  exact created submission and acceptance evidence remain mandatory, while
  missing or contradictory delivery evidence still fails closed to prevent a
  duplicate resend
- Stalwart fresh sends and autosaved provider-draft sends whose primary
  `Email/set` and `EmailSubmission/set` results are conclusive but whose
  implicit Draft-to-Sent update is incomplete now verify the exact created
  message independently, repair only a confirmed Sent message with a
  state-guarded idempotent update, remove internal draft-operation keywords,
  and use bounded delayed re-reads when Stalwart's Sent membership is not yet
  visible. An exact successful `EmailSubmission/set` remains authoritative
  even when that independent Sent-state repair is inconclusive, and an exact
  implicit destruction of the exact created copy is also accepted. Missing or
  ambiguous submission evidence remains an uncertain delivery, preserving
  duplicate-send protection
- The first edit of an already-loaded provider draft now seeds its exact draft
  ID and revision into the local recovery journal before preparing the update.
  This keeps the fail-closed recovery contract while allowing the provider save
  request to proceed instead of incorrectly reporting that no recovery copy
  could be kept
- Stalwart 0.16 plain-text drafts now round-trip when the server returns null
  grouped-address instances for empty Cc/Bcc headers, mirrors the sole text
  part in `htmlBody`, and includes the full message header inventory on the
  root MIME part. Normalization is exact and bounded, malformed non-empty
  headers still fail closed, and newly created drafts omit empty recipient
  properties
- Playwright regression batches use the stable Next.js webpack development
  server after an upstream Turbopack aggregation panic terminated long CI runs
  mid-download and left later composer requests permanently unavailable. The
  full quality job now has a 30-minute budget after a verified run consumed
  19m44s of its previous 20-minute limit

### Added

- Added server-authoritative administrator/member session inventories with
  selective revocation, privacy-safe management handles, coarse client labels,
  30-minute idle and 12-hour absolute expiry, fail-closed ambiguous-origin
  rejection, and an optional atomic Redis-backed shared login limiter whose
  account/source keys are HMAC-pseudonymized
- Added an administrator-only security audit log with strict privacy-bounded
  events, keyed actor/target pseudonyms, attempt/outcome settlement, 10,000-event
  retention, HMAC entry chaining and whole-file verification, mode-0600 atomic
  persistence, verified pagination, an accessible administration view, and
  operator backup/incident guidance. Authentication, setup, administrator
  changes, 2FA, rules, standard-data exports/imports, mailbox emptying, and
  permanent message destruction now emit scoped events

- Privacy-bounded structured JSON logs, validated API request correlation IDs,
  process-local Prometheus metrics behind an optional bearer token, separate
  liveness/readiness endpoints, provider operation latency/error aggregation,
  and a self-hosted dashboard and alerting runbook
- Configurable organization message and attachment limits plus extension and
  scanner-detected MIME allow/block rules. The rollback-safe atomic policy is
  enforced before quarantine allocation, after scanning, during original-file
  forwarding and provider-draft save, and again for immediate and scheduled
  delivery so policy changes cannot be bypassed by an older saved draft
- Provider-aware administrator capability matrix and organization-wide member
  self-service policy for profile edits, mailbox-password changes, and new
  Veda-managed 2FA enrollment. Policy writes are authenticated, same-origin,
  rate-limited, strictly validated, atomically persisted in a rollback-safe
  standalone record, and enforced again by member APIs before provider work
- Provider-independent contacts for JMAP and IMAP/SMTP identities, including
  encrypted owner-isolated contacts, groups, delivery-confirmed recent-recipient
  history, keyboard-accessible To/CC/BCC autocomplete, optimistic revisions,
  and accessible management controls. Bounded vCard 3.0/4.0 import maps
  categories to groups; deterministic vCard 4.0 export uses safe CRLF folding,
  no-store download headers, and no URI or binary payload fetching
- Reader actions now stay visibly scoped to the selected conversation message;
  a native accessible disclosure shows normalized From, To, Cc, Reply-To, date,
  message size, attachment summary, and conversation position without exposing
  provider IDs or raw headers. Plain-text reply/forward history and sanitized
  HTML blockquotes start collapsed and can be restored without changing the
  source message
- Provider-backed conversation views with an authenticated, rate-limited,
  cursor-paginated API and accessible reader navigation. Stalwart uses exact
  `Email/get`/`Thread/get` membership; IMAP uses exact native thread IDs when
  available and otherwise a bounded, post-verified Message-ID/In-Reply-To/
  References graph. Results are capped at 100 messages, page 25 at a time,
  deterministically ordered, snapshot-bound between pages, and never grouped
  by subject. Dedicated rate limits, partial header fetches, stable in-reader
  navigation, and selected-message mailbox rights bound provider cost and
  cross-folder actions
- Opt-in, encrypted per-account mailbox shortcuts with an accessible `?` guide,
  search/compose navigation, loaded-message traversal, reader actions, and
  `aria-keyshortcuts` discovery. Single-key commands are suppressed in every
  editable surface, rich composer, modal, modified/repeated key event, and
  unavailable action; reader/list focus handoff, live announcements, a skip
  link, and bounded small-screen preference scrolling complete the keyboard
  and assistive-technology slice
- Account-private send confirmation and provider-independent Undo Send with
  configurable 5/10/20/30-second windows. Delayed sends first persist the exact
  provider draft and then enter the encrypted durable queue; the global
  countdown atomically cancels a still-pending job and reopens that same draft.
  A committed delivery lease is never recalled or automatically retried, and a
  single-flight composer guard prevents rapid duplicate submissions
- Provider-independent scheduled send for both JMAP and IMAP/SMTP. Scheduling
  first persists the exact provider-backed draft, then stores a bounded
  canonical job and provider connection in an AES-256-GCM envelope under a
  dedicated external key. The durable worker supports future UTC times,
  cancel/reschedule, bounded retries, restart recovery, and review-only
  ambiguous outcomes without automatically risking a duplicate delivery; the
  accessible Scheduled manager exposes state and recovery guidance
- Provider-independent reusable email templates with encrypted, owner-isolated
  local persistence and optimistic revision conflicts. The composer can create,
  update, delete, insert at the current selection, or explicitly replace only
  subject/body after a destructive confirmation. Templates never store
  recipients, attachments, reply metadata, provider IDs, or managed signatures;
  rich content is sanitized before encryption and again at draft/send time
- Provider-durable draft attachments for Stalwart JMAP and Standard IMAP/SMTP.
  Clean quarantine uploads now autosave into the provider Drafts mailbox,
  survive reload, can be retained or removed through exact draft-scoped opaque
  IDs, and send from the authoritative saved copy. Combined selection, decoded
  bytes, MIME shape, digest, revision, lost-response, and concurrent-replacement
  checks fail closed without exposing provider blob or part identifiers
- Account-private mailbox preferences for compact, comfortable, or spacious
  density, newest/oldest provider mailbox order, optional bounded preview
  snippets, send confirmation, and Undo Send delay. Preferences are encrypted
  on the Veda Mail data volume and legacy records migrate to safe off defaults;
  list cursors are HMAC-authenticated, expire after 30 minutes, and are bound to
  the mailbox, search, sort, preview mode, and fixed page size. Stalwart JMAP
  requests a normalized preview only when enabled; Standard IMAP deliberately
  leaves list previews empty because summary listing does not fetch message
  bodies
- Permission-aware message move by internal drag/drop plus complete keyboard
  and touch dialogs from both list and reader. Moves use exact source and
  destination mailboxes, preserve failed selections across bounded 100-message
  chunks, and enforce provider rights and current membership on the server;
  JMAP uses state-conditioned membership patches and IMAP requires native MOVE
  so unrelated deleted messages can never be expunged as a fallback
- Dedicated Spam and Trash lifecycle UX with provider-neutral retention hints,
  role-aware bulk and reader actions, rights-aware irreversible confirmations,
  and resumable Empty Spam/Trash operations. Cleanup state is encrypted and
  server-owned; JMAP query-state snapshots abort on post-confirmation additions,
  while IMAP binds an initial UID ceiling to UIDVALIDITY/OBJECTID and requires
  exact UIDPLUS expunge, so later arrivals and unrelated deleted messages remain
  untouched
- Provider-portable account labels with encrypted owner-isolated catalogs,
  stable opaque JMAP keyword/IMAP user-flag mappings, create/rename/recolor UI,
  single and bulk apply/remove controls, capability/right/capacity checks,
  conditional JMAP updates, verified IMAP STORE operations, and strict scoped
  APIs
- Two-phase portable-label deletion with explicit confirmation, durable
  encrypted progress, expiring single-batch leases, bounded JMAP/IMAP cleanup,
  HMAC-authenticated cursors, credential-rotation restart, in-flight mutation
  serialization, automatic resume, two empty verification passes, and retained
  tombstones
- Provider-independent interrupted-compose recovery plus capability-gated
  provider autosave. Raw recipients and body content stay in a strictly
  validated, session/owner-bound IndexedDB journal; session storage contains
  only opaque discovery pointers. Recovery survives reloads and closed tabs
  during the same authenticated session, while visible saving, locally
  recovered, offline, attachment-only, and failure states explain durability
- Debounced provider autosave with a two-second idle delay, a fifteen-second
  maximum wait, one in-flight request plus one latest trailing save, exact
  lost-response reconciliation, offline pause, and capped 2/4/8/16/30-second
  retry backoff
- Explicit interrupted-send and interrupted-discard recovery. Every send is
  journaled before HTTP and an ambiguous outcome can only enter a Check Sent
  flow; permanent discard can replay only the exact confirmed provider draft
  ID and revision
- Runtime-gated Stalwart JMAP manual drafts: provider-backed create, Drafts
  list/open, create-first immutable update, explicit discard, visible
  save/recovery state, and claim-gated save-first submission. Bounded
  non-transmitted JMAP markers reconcile lost responses; uncertain sends remain
  visibly locked against duplicates, while incomplete bodies, attachments,
  unsupported raw headers/address groups, and non-canonical MIME structures
  remain non-destructively read-only in this first slice
- Stalwart administrator mailbox-user list, safe detail, search/pagination,
  and ordinary-user creation with a server-only least-privilege management
  key, allowed-domain isolation, admin password/2FA step-up, negative-cache
  invalidation, and durable secret-free idempotency
- Encrypted, session/draft-bound attachment quarantine with safe names, exact
  byte quotas plus global capacity ceilings, magic-number MIME detection,
  ClamAV scanning, idle/absolute/verdict deadlines, scheduled expiry,
  cancel/remove, and byte-identical JMAP or IMAP/SMTP sending
- Authenticated received-attachment downloads for JMAP and IMAP, with
  message-scoped opaque identifiers, bounded streaming, and truthful provider
  capability metadata
- Fail-closed malware inspection for received downloads. Known- or
  unknown-length provider bytes are staged once into a request-scoped,
  AES-256-GCM encrypted spool, hashed and completely scanned before the same
  clean copy can be served. Infection, scanner outage, timeout, dishonest
  length, corruption, quota pressure, or cancellation releases no attachment
  bytes and removes the ciphertext
- Server-streamed Download all archives for JMAP and IMAP, with authoritative
  metadata lookup, root-only collision-safe filenames, STORE-mode CRC-verified
  ZIP entries, byte/count/deadline limits, cancellation-safe concurrency, and
  actionable preflight failures
- Server-authoritative forwarding of original received attachments through
  bounded plaintext staging, malware scanning, MIME verification, and the
  encrypted outbound quarantine
- Official ClamAV sidecar pinned to a zero-HIGH/CRITICAL `linux/amd64` digest
  with a persistent signature database and fail-closed platform preflight
- A repository-pinned ClamAV policy with bounded input, expanded scan bytes,
  recursion, contained files, scan time, threads, queue, CPU, memory, PIDs and
  temporary storage. Encrypted content and limit-exceeded scans are blocked
  instead of being reported clean
- CC and BCC composing, including CC-only and BCC-only delivery
- Reply All with identity exclusion, recipient deduplication, and
  provider-derived `In-Reply-To` and `References` headers
- Plain-text forwarding with readable original-message metadata
- Reader To/CC metadata and compose focus management
- Safe rich-text composing with semantic headings, bold/italic/underline,
  ordered and unordered lists, isolated links, undo/redo, plain-text mode, and
  browser spellcheck. The client editor uses version-pinned, MIT-licensed
  Lexical 0.44.0 and accepts pasted or dropped content as plain text only
- Multiple named plain or sanitized-rich signatures with explicit save,
  separate new-message and reply/forward defaults, conflict-safe settings,
  exact-once new/reply/forward placement, and a None/change composer picker
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

- Download all now fully stages and scans every original attachment before the
  first ZIP byte is emitted. The generated archive still stores nested archives
  as byte-identical opaque files and never expands provider content in the Veda
  Mail process
- All attachment inspection paths share one bounded FIFO scanner scheduler with
  explicit queue, connect, idle, absolute-operation, and verdict deadlines
- Download all now exchanges the scoped authenticated preflight for a 30-second,
  256-bit, single-use ticket bound to the exact connection and message. The
  reusable mailbox-session scope no longer appears in native-download URLs;
  replay, expiry, wrong binding, request bodies, ranges, and extra query values
  fail before provider access
- Stalwart JMAP attachment downloads now accept standards-compliant chunked
  identity responses when no length is declared, while enforcing authoritative
  known lengths and the streaming byte ceiling
- Closing a composer now removes ordinary local recovery before hiding content,
  preserves unresolved terminal-operation evidence, and confirms before
  abandoning in-progress attachment copies. Sign-out always asks for
  session-wide confirmation because another tab may own unrecovered work.
  Exact-scope sign-out, expiry, and invalidation hide matching mailbox content
  across tabs while local cleanup runs; failures retain a retryable privacy
  curtain without repeating the server sign-out request
- Mail workspace responses now include the exact member-session expiry used to
  bind and expire browser recovery data
- Stalwart submission now validates the exact implicit Drafts-to-Sent update;
  malformed, partial, wrong-account, or issued ambiguous cleanup outcomes are
  terminal uncertain rather than accepted or blindly retried
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
- Composer attachment cleanup now keeps a synchronous active-draft identity and
  removes every completed upload through the draft that originally reserved it,
  preventing rapid close/reopen or forward rotation from leaving quarantine
  records behind or targeting the next draft
- Signature settings now record the rich editor's initial snapshot separately
  from user changes, so the first edit is never absorbed into the saved
  baseline. Create, save, delete, and default controls remain unavailable until
  the authoritative signature book has loaded
- Dependency auditing now covers the complete production and development tree
- Runtime images pin the Node base digest and exclude unused package managers
- Provider attachment streams now reject cumulative zero-byte chunk floods
  instead of allowing a no-progress stream to retain resources

### Security

- Bind compose recovery to the exact provider, account, server-issued session
  scope, and session expiry. Enforce strict schemas and a 3 MiB record ceiling,
  compare-and-swap revisions, record/scope tombstones, newest-first capacity,
  bounded expiry cleanup, cross-tab revocation, and sign-out/session-invalidation
  purge. Attachment bytes are never persisted in the journal
- Treat network failures, HTTP 408, server failures, and an ended in-flight send
  session as ambiguous after a send intent is armed. The current UI blocks a
  second send or discard immediately, and reload recovery never exposes a send
  replay operation
- Derive signature ownership from the authenticated gateway account, encrypt
  each canonical signature book with an owner-bound AES-256-GCM key, hide raw
  identities behind HMAC keys, and persist only through bounded, atomic
  mode-0600 writes. Same-origin checks, verified-session rate limits, strict
  schemas, stale-revision conflicts, server-validated connection scopes, and
  the outbound sanitizer apply before provider submission
- Version signature owner keys so provider IDs and email domains remain
  case-insensitive while the email local-part remains case-sensitive. Only v2
  owner buckets are accepted; case-collapsed pre-release v1 buckets are ignored
  without automatic adoption or migration
- Require the workspace-issued connection scope on every later account-derived
  mail, signature, profile/password/2FA, sign-out, delivery-notice, send, and
  attachment operation; reject cross-tab cookie replacement before provider
  work, terminally invalidate the mounted mail model on 409/401 until a full
  reload, and enforce the route invariant in the architecture gate
- Reset attachment capability state at layout time whenever the accepted
  session scope changes. Pair the SSR upload limit with its exact server-derived
  initial scope, reuse it only when the client accepts that same scope, and
  otherwise clear it until a scoped refresh; discard an earlier account's late
  capability response instead of exposing it in the replacement session
- Enforce a per-document nonce Content Security Policy, retain only the reviewed
  message-frame script hash and React style-attribute exception, and emit
  production host-only HSTS
- Keep attachment and archive `no-referrer` plus sandbox policies authoritative
  by excluding API routes from the document security-header proxy
- Keep provider attachment identifiers server-only; require opaque upload IDs,
  AES-256-GCM integrity, SHA-256 verification, dynamic provider limits, and
  strict fail-closed scan verdicts
- Force received attachments to download as non-cacheable, non-transformable
  octet streams with sanitized `Content-Disposition`, `nosniff`, sandbox CSP,
  same-origin resource policy, range rejection, and a 50 MiB decoded-byte
  ceiling. The browser rejects malformed, oversized, dishonest, or truncated
  streams and cleans up failed download handoffs
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
