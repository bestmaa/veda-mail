# Veda Mail product roadmap

This roadmap turns Veda Mail into a production-grade, provider-independent,
self-hosted webmail suite. Features must remain usable with open protocols and
open-source components. Provider-specific acceleration is allowed only behind
capability-checked adapters; the core product cannot require a proprietary
Google service.

## Definition of done

A roadmap item is complete only when all of the following are true:

- Domain and provider contracts are documented and implemented for every
  advertised provider, or the UI clearly reports an unsupported capability.
- Success, validation, authorization, provider-failure, and regression paths
  have automated tests at the appropriate boundary.
- `npm run check`, `npm run test:coverage`, `npm run test:e2e`,
  `npm run build`, and `npm audit --audit-level=high` pass.
- User-controlled HTML, URLs, addresses, filenames, uploads, and downloads are
  validated at a server boundary and rendered with safe defaults.
- Keyboard use, focus, screen-reader labels, narrow screens, loading states,
  empty states, and recoverable errors are covered.
- Documentation, upgrade notes, and the feature matrix are current.
- A multi-platform container is published, deployed to the staging/production
  target, and its health and critical user flow are verified.

## Product principles

- JMAP is the preferred full-feature protocol; IMAP/SMTP remains a supported
  compatibility path.
- The server owns provider credentials and sensitive transformations. Browser
  storage never contains mailbox passwords or long-lived provider tokens.
- Mail remains on the configured mail server unless a documented feature
  requires encrypted Veda Mail metadata.
- Background work must be idempotent, observable, retryable, and safe across
  restarts before scheduled features are advertised as production-ready.
- Destructive actions have confirmation or a short recovery window.
- Feature availability is derived from provider capabilities, never guessed.

## Current baseline

- [x] Protected first-run setup and organization branding
- [x] Separate administrator and mailbox-member authentication
- [x] Administrator and member authenticator-app 2FA
- [x] Stalwart JMAP and standard IMAP/SMTP adapters
- [x] Inbox/mailbox list, message reader, simple search, compose, single reply
- [x] Read/unread, star, archive, trash, restore, and move provider operations
- [x] Sanitized HTML reader with scripts and remote images blocked, plus bounded
  verified inline CID raster images
- [x] Docker/GHCR distribution, architecture checks, and automated tests

## M0 — Quality, security, and capability foundation

Priority: blocking. This gate keeps rapid feature work from turning advertised
capabilities into untested or unsafe UI.

- [x] Publish a provider capability matrix and remove claims that do not have
  callable gateway contracts
- [x] Expose provider capabilities to the member UI and visibly report
  unsupported actions
- [x] Bound and validate JSON request bodies before buffering; cap recipient
  count/name/address lengths and deduplicate recipients across To/CC/BCC
- [x] Add per-session and global rate limits to mailbox reads and mutations
- [x] Add Playwright critical-flow, keyboard-focus, and mobile-viewport
  regression tests
- [x] Add automated WCAG browser checks for serious/critical violations
- [x] Add component and route-integration harnesses
- [x] Require coverage thresholds, a full dependency audit, and a
  warning-free production build
- [x] Add secret scanning, static security analysis, and container/OS scanning
- [x] Centralize the inbound HTML sanitizer and add a malicious active-content
  regression corpus
- [x] Codify the shared policy for future outbound rich text and expand the
  provider MIME and mutation-XSS corpus
- [x] Document a threat model for sessions, provider SSRF, HTML mail,
  attachments, forwarding, rules, imports, and durable scheduled work
- [x] Keep an explicit single-replica support boundary until shared encrypted
  sessions and a distributed rate limiter are implemented

Acceptance: the login → inbox → read → send flow passes in a real browser and
mobile viewport with no critical accessibility violations; every advertised
capability is implemented or visibly unavailable; abuse tests and all release
gates pass.

## M1 — Complete everyday compose and reader flows

Priority: critical. These are the gaps that make the current client feel
incomplete for normal business mail.

- [x] CC and BCC fields with accessible disclosure controls, recipient
  validation, deduplication, and server-side limits
- [x] Reply All that excludes the signed-in identity, preserves To/CC intent,
  deduplicates recipients, and writes standards-compliant reply headers
- [x] Forward text with a readable original-message block
- [x] Inline reader metadata for To, CC, and attachment size/type
- [x] Focus management, keyboard escape, sending lock, and actionable errors

Acceptance: a member can send To/CC/BCC mail, reply, reply to all, and forward
through both included provider adapters. Recipients and MIME/thread headers are
verified from the receiving side, not only from UI state.

Implementation and automated adapter/browser coverage are complete. Live
receiving-side interoperability remains the release verification gate.

## M2 — Secure attachments

- [x] Upload attachments with per-file/count/total limits, safe filenames,
  truthful content types, cancel/remove controls, and provider capability checks
- [ ] Download attachments through an authenticated, non-cacheable endpoint
  using safe `Content-Disposition`, `nosniff`, and streaming limits
- [ ] Forward original attachments without trusting client-supplied blob IDs
- [ ] Download all as a bounded, server-streamed, collision-safe ZIP
- [ ] Safe attachment preview allowlist with isolated renderers (plain-text v1
  implemented; live JMAP/IMAP/ClamAV acceptance remains before completion)
- [x] Inline CID JPEG/PNG/WebP handling for JMAP and IMAP without
  remote-content leakage, capped at eight rendered images per message and a
  1,600-pixel output dimension
- [x] Render supported sequential JMAP JPEG/PNG/WebP body parts that are not
  referenced from an HTML `cid:` URL, with unsupported media as attachment
  fallback
- [x] Add bounded 429/503 retry with sanitized alt-text fallback for transient
  inline-image preparation failures
- [x] Add an explicit manual retry control for inline images that remain
  unavailable after the bounded automatic retry
- [ ] Open-source malware-scanner hook, quarantine state, timeouts, and archive
  expansion defenses

Acceptance: allowed attachments send and download byte-identically through both
providers; authorization, size, MIME, filename, timeout, content-sniffing, and
malicious-file tests pass.

## M3 — Draft-safe, rich composing

- [ ] Provider-backed create, update, list, open, and discard drafts
- [ ] Debounced autosave with visible saving/saved/offline/error status
- [ ] Restore an interrupted compose session without duplicating a draft
- [ ] Safe rich-text editor: headings, emphasis, lists, links, and plain-text
  alternative; no arbitrary scripts, event handlers, remote embeds, or styles
- [ ] Per-identity signatures with plain-text and sanitized-rich variants
- [ ] Reusable templates with explicit insert/replace behavior
- [ ] Send confirmation preference and an undo-send delay backed by a durable
  queue
- [ ] Spellcheck and keyboard shortcuts without trapping assistive technology

Acceptance: reloading or losing the network cannot silently lose a draft, and
the MIME message has equivalent readable HTML and plain-text parts.

## M4 — Fast mailbox management

- [ ] Cursor pagination/infinite loading with stable selection
- [ ] Multi-select and bulk read/unread, star, archive, spam, trash, restore,
  move, and permanent-delete actions
- [ ] Create, rename, recolor, nest, and delete custom folders/mailboxes
- [ ] Portable labels model with a documented IMAP mapping
- [ ] Dedicated spam and trash behavior, empty-folder action, retention hints,
  and safe permanent-delete confirmation
- [ ] Drag/drop or keyboard move with an accessible non-pointer alternative
- [ ] Configurable density, sorting, and message-list preview
- [ ] Optimistic updates with rollback and partial-failure reporting

Acceptance: operations on large selections are bounded, cancellable where
possible, and report which messages failed without corrupting local state.

## M5 — Conversations and powerful search

- [ ] Provider-backed conversation/thread view with deterministic fallback
- [ ] Reply/forward placement, quoted-content collapsing, and per-message details
- [ ] Search grammar for from, to, cc, subject, body, dates, size, attachment,
  unread, starred, mailbox, and exact phrases
- [ ] Search suggestions, recent searches, clear active-filter chips, and
  shareable URL state without leaking credentials
- [ ] Saved searches or virtual mailboxes
- [ ] Print-friendly message/conversation view

Acceptance: thread membership and search semantics have provider contract tests;
unsupported predicates are reported rather than silently ignored.

## M6 — Rules and productivity

- [ ] Server-side filters/rules: match sender, recipient, subject, headers,
  size, or attachment; then move, label, star, mark read, or discard
- [ ] Rule ordering, enable/disable, dry-run preview, conflict handling, and
  audit history
- [ ] Scheduled send using an encrypted durable queue, retry policy,
  cancellation, clock/time-zone handling, and idempotency keys
- [ ] Snooze with durable wake-up scheduling and mailbox restoration
- [ ] Contacts, recent-recipient ranking, autocomplete, groups, and vCard
  import/export
- [ ] RFC 5545 calendar invitation display, accept/maybe/decline, and `.ics`
  import/export; CalDAV integration remains capability-gated
- [ ] Vacation responder and delegation only where the provider advertises them

Acceptance: restart, duplicate-delivery, daylight-saving, and provider-outage
tests prove scheduled work is not lost or executed twice.

## M7 — Notifications, offline resilience, and accessibility

- [ ] New-mail refresh using JMAP events/push where available and bounded polling
  fallback for IMAP
- [ ] In-app and opt-in Web Notifications with privacy-safe content controls
- [ ] PWA installability and an explicitly bounded offline cache
- [ ] Network reconnection, stale-state indicators, and safe retry behavior
- [ ] WCAG 2.2 AA keyboard, focus, contrast, zoom/reflow, motion, and
  screen-reader audit
- [ ] Localization foundation, locale-aware dates/numbers, RTL layout, and
  selectable time zone

Acceptance: notification permissions are never coerced, private message content
is not cached by default, and the primary flows pass automated and manual
assistive-technology checks.

## M8 — Administration, operations, and trust

- [ ] Admin feature/capability matrix and per-organization policy controls
- [ ] Configurable message/attachment limits and allowed/blocked file policy
- [ ] Optional open-source malware scanner integration with quarantine states
- [ ] Structured redacted logs, request correlation, metrics, health/readiness,
  provider latency/error dashboards, and alerting guidance
- [ ] Security audit log for administrator, authentication, rule, delegation,
  export, and destructive mailbox actions
- [ ] Session inventory/revocation, idle/absolute expiry, CSRF review, login
  throttling, and distributed rate-limit option
- [ ] Encrypted shared session and job repositories for multi-replica operation
- [ ] Export/import of settings, contacts, rules, and mail in standard formats
- [ ] Backup/restore drill, data-retention controls, privacy documentation,
  threat model, SBOM, provenance, dependency policy, and release checklist

Acceptance: a clean installation, upgrade, rollback, backup restore, replica
restart, and provider outage are exercised from documented runbooks.

## Delivery order

Work proceeds in small vertical slices. For every checkbox: contract and threat
review, implementation, focused tests, full quality gates, documentation,
container publication, deployment, and production verification happen before
the next slice is marked complete. If a provider cannot implement a feature,
its manifest must state that limitation and the UI must disable it with a clear
explanation.
