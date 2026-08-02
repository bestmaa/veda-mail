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
- [x] Least-privilege Stalwart administrator user list/detail/create with
  allowed-domain isolation, step-up authentication, and durable idempotency
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

Direct download, original-attachment forwarding, and Download all implementation
plus automated security/browser coverage are complete. Their checkboxes remain
open until receiving-side SHA-256 and response-header evidence is recorded from
dedicated live JMAP and IMAP/SMTP mailboxes. Download all now uses a 30-second,
single-use connection/message-bound ticket, so the reusable mailbox-session
scope never appears in a native-download URL. JMAP downloads also support
standards-compliant unknown-length identity streams while retaining exact
verification whenever a length is known and the existing byte ceiling always.

The received-malware vertical slice is also implemented for direct and Download
all delivery: the exact known- or unknown-length provider stream enters an
AES-256-GCM, scope-bound, single-use spool; all entries must receive a complete
clean ClamAV verdict before any attachment or ZIP byte is emitted. Shared scan
concurrency and connect/idle/absolute/verdict deadlines fail closed. A pinned
`clamd.conf` blocks encrypted or limit-exceeded content and bounds expanded
archive bytes, recursion, files, parser work, CPU, memory, PIDs and temporary
storage. Unit, adversarial, route, browser, real JMAP/IMAP adapter and live
ClamAV nested/limit fixtures cover the implementation. The malware-scanner
checkbox remains open only until the immutable release is deployed and the live
mailbox evidence above plus production scanner health are recorded.

## M3 — Draft-safe, rich composing

- [x] Provider-backed create, update, list, open, and discard drafts
- [ ] Provider-durable attachment autosave and saved-draft attachment sending
- [x] Debounced autosave with visible saving/saved/offline/error status
- [x] Restore an interrupted compose session without duplicating a draft
- [x] Safe rich-text editor v1: headings, emphasis, lists, isolated links,
  browser spellcheck, and an explicit plain-text mode. The server creates the
  readable plain alternative and removes scripts, event handlers, remote
  embeds, and arbitrary styles before either included provider sees content
- [x] Per-identity signatures with multiple named plain-text and
  sanitized-rich variants, explicit new/reply-forward defaults, and exact-once
  composer insertion
- [ ] Reusable templates with explicit insert/replace behavior. The encrypted,
  provider-independent implementation, abuse tests, accessibility checks, and
  full local browser suite are complete; this remains open until the immutable
  release is published and the live production create/reload/insert/replace
  smoke evidence is recorded
- [ ] Send confirmation preference and an undo-send delay backed by a durable
  queue
- [ ] Complete the keyboard-shortcut and assistive-technology audit beyond v1
  browser spellcheck and standard formatting shortcuts

Acceptance: reloading or losing the network cannot silently lose a draft, and
the MIME message has equivalent readable HTML and plain-text parts.

Rich-text v1 meets the equivalent HTML/plain provider-send requirement.
The send-confirmation and Undo Send implementation is locally complete:
encrypted backward-compatible account preferences, exact provider-draft save,
5/10/20/30-second durable queue jobs, atomic pre-lease cancellation, global
countdown, exact draft restore, duplicate-submit locking, accessibility checks,
and JMAP/IMAP-portable browser coverage. The checkbox remains open until its
immutable release and live production schedule/undo evidence are recorded.
Stalwart JMAP and Standard IMAP/SMTP now have security-reviewed provider-draft
vertical slices: create, update, Drafts-list/open, discard, save-first send,
  lost-response reconciliation, serialized autosave, visible state, durable
  persistence for scanned uploads, and non-destructive guards for incomplete
  bodies plus unsupported imported headers/MIME. IMAP additionally requires a
  writable special-use Drafts mailbox and UIDPLUS, binds opaque IDs to
  UIDVALIDITY, verifies every
appended MIME replacement before deleting the old UID, and serializes Veda
saves/sends per account and compose ID.
All providers also receive session-bound local crash recovery and terminal
send/discard protection. Uploads remain encrypted, session/compose-bound
quarantine objects until a successful provider save consumes them; the returned
provider attachment inventory then survives reload and can be retained or
removed by opaque ID without exposing JMAP blob IDs or IMAP MIME locators.
The attachment slice was merged as `3f2a421` and published as multi-platform
image digest
`sha256:242a80237308861ba848035aa834dc21f14404044054b83ff99638cd08f9e643`.
The reusable-template slice was merged as `d0afd06` and published as the
scanned, attested amd64/arm64 image digest
`sha256:688e8a3b0c8f5dad2c5c4d3fd5c42fee59e702042de0d750c3cb8f6dcb465eac`.
Production deployment and live health/critical-flow evidence remain open for
both slices: the Dokploy hostname `panel.wovvtec.site` and public mail hostname
`mail.wovvtec.site` still returned authoritative DNS `NXDOMAIN` on 2026-08-02.
Completing this milestone still requires that live deployment evidence,
delayed send, and the broader shortcut/accessibility audit listed above.

## M4 — Fast mailbox management

- [x] Cursor pagination/infinite loading with stable selection
- [x] Multi-select and bulk read/unread, star, archive, spam, trash, restore,
  move, and permanent-delete actions
- [x] Create, rename, recolor, nest, and delete custom folders/mailboxes
- [x] Portable labels model with a documented IMAP mapping
- [x] Dedicated spam and trash behavior, empty-folder action, retention hints,
  and safe permanent-delete confirmation
- [x] Drag/drop or keyboard move with an accessible non-pointer alternative
- [x] Configurable density, sorting, and message-list preview
- [x] Optimistic updates with rollback and partial-failure reporting

Acceptance: operations on large selections are bounded, cancellable where
possible, and report which messages failed without corrupting local state.

Cursor pagination is complete for both included adapters with a server-owned
50-message page size, bounded signed context-specific cursors, an accessible
Load more control, duplicate-request coalescing, cross-page message-ID
deduplication, stale mailbox/search/session response rejection, recoverable
retry, and stable reader selection. Offset movement during concurrent provider
mutation remains documented; refresh restarts from the authoritative first
page.

The density/sort/preview slice is deployed with three density modes,
newest/oldest provider mailbox order, encrypted account preferences, and
privacy-bounded JMAP previews. Standard IMAP truthfully shows no list snippet
because its summary path does not fetch message bodies. Merge `a52b21f` was
deployed from immutable release digest
`sha256:12e0aa9f46f01b595d5ba407b0691e1aa2b794cc9df1b1f8b3c34737015d51e5`;
Dokploy reported the exact amd64 image config, a healthy container, and a
durable named volume at `/data`. The production health endpoint returned HTTP
200 at `2026-08-01T16:01:14.621Z`, and setup status confirmed the installation
is complete on that volume.

Message mutations now use a session-scoped, view-versioned optimistic
transaction layer. Read, star, label, archive, trash, restore, spam, and move
actions project into the loaded list and open reader before provider
confirmation; exact per-ID failures restore only rejected rows and fields.
Unknown transport/provider outcomes stay explicitly unconfirmed until an
authoritative refresh, newer intent supersedes older uncertain projections,
and permanent deletion remains confirmation-first. Bulk response envelopes
must contain a complete, unique `succeeded`/conservative-`failed` partition;
an optional `unconfirmed` subset lets newer clients reconcile ambiguity while
rolling clients fail safely. Client operations are capped at 2,000 IDs across
server-bounded 100-ID batches and can stop after the current batch. Pending
rows expose `aria-busy`, progress and partial outcomes remain visibly
announced, unrelated selection is preserved, and Spam/Trash destruction now
also requires provider removal rights and exact provider confirmation.

Loaded-page multi-select and bulk actions are complete for both adapters.

Custom mailbox management is complete for both adapters. The sidebar exposes
accessible create/edit controls, hierarchy, a bounded color palette, and a
two-step delete confirmation. JMAP uses state-conditioned `Mailbox/set` with
native `parentId` and rights; IMAP uses delimiter-safe CREATE/RENAME/DELETE and
rechecks STATUS immediately before deletion. System folders are immutable,
names and depth are bounded, sibling collisions and cycles are rejected, and
only empty childless custom folders may be deleted. Non-standard colors live
in an account-isolated encrypted `/data/mailbox-appearance.json` sidecar and
migrate across IMAP rename IDs. One residual IMAP race remains because the
protocol has no atomic “delete only if still empty” primitive.

Drag/drop and the complete keyboard/touch move alternative are implemented
and verified for list, multi-select, reader, partial-failure, and mobile flows.
The browser carries only an opaque per-drag token, requests use exact
source/destination mailbox IDs in bounded 100-message chunks, and the server
rechecks mailbox rights plus current membership. Merge `4d4f329` was deployed
from immutable release digest
`sha256:e672430ae5de17c18ded6a4b1bb153882189f73977a641577646154f549c503d`;
the production health endpoint returned HTTP 200 at
`2026-08-01T13:51:47.440Z`.

Portable label create, rename, recolor, display, bulk/single apply, and remove
are implemented for both included adapters. Opaque stable IDs map to JMAP
keywords or capability-checked IMAP user flags; the encrypted account catalog,
strict scoped APIs, state/right/capacity checks, post-mutation verification,
accessible UI, and provider/security tests are complete. The immutable release
image is deployed and verified healthy in production. Resumable two-phase
deletion blocks new applications, persists bounded provider progress behind an
expiring lease, survives interruption, requires two empty checks, and retains a
tombstone.

Selection is explicitly limited to loaded messages, excludes editable Drafts,
survives only within the current mailbox/search/session view, and retains only
provider failures after a partial result. Strict unique batches are capped at
100 IDs, execute with four provider operations at most, and expose no upstream
error text. Read/unread, star/unstar, archive, spam, trash, restore, move, and
irreversible delete are available according to mailbox role; permanent delete
is limited to Spam/Trash and requires a focus-managed confirmation.

Dedicated Spam/Trash lifecycle implementation now includes provider-neutral
retention hints, rights-aware role actions, reader restore/not-spam, and
prepare-first Empty actions. Encrypted server-owned progress resumes only after
a durable snapshot: JMAP aborts on post-confirmation query additions, while
IMAP binds an upper UID to UIDVALIDITY/OBJECTID and requires UIDPLUS. Release
digest `sha256:af01a2ab82735b3ba613b19d94038bcc3c425af8a31ac3636b93ed5fb7c35d25`
was deployed on 2026-08-01; Dokploy confirmed the image pull and container
recreation, and the public `/api/health` endpoint returned HTTP 200.

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

The provider-independent scheduled-send implementation is released:
exact-revision provider drafts, encrypted credential/content envelopes under an
external deployment key, atomic leases, six-attempt bounded backoff,
dead-letter and review-only uncertain states, UTC/IANA-time-zone UI,
cancel/reschedule management, restart recovery, and security/component/route
tests cover both provider paths through their shared saved-draft send contract.
It merged as `5b69087` and was published as scanned, attested multi-platform
image digest
`sha256:ab523bca5479de95e8b4123fee54fceaba825c225187693959f8ad5d9659e80b`;
the verified amd64 and arm64 child digests are
`sha256:219d72003e194a9f72da5fa94c818d6811ec1078a47287a528a1475880f4a554`
and
`sha256:96428ff91f54f8d15ee03ea62076caf4450d164b0354844a4ff802da233b0be5`.
The checkbox remains open until production deployment and live JMAP plus
IMAP/SMTP schedule/cancel/restart evidence are recorded. That deployment could
not proceed on 2026-08-02 because `wovvtec.site`, `panel.wovvtec.site`, and
`mail.wovvtec.site` all returned DNS `NXDOMAIN`.

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
