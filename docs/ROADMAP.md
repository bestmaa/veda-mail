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
- [x] Download attachments through an authenticated, non-cacheable endpoint
  using safe `Content-Disposition`, `nosniff`, and streaming limits
- [x] Forward original attachments without trusting client-supplied blob IDs
- [x] Download all as a bounded, server-streamed, collision-safe ZIP
- [x] Safe attachment preview allowlist with isolated renderers (plain-text v1)
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
- [x] Open-source malware-scanner hook, quarantine state, timeouts, and archive
  expansion defenses

Acceptance: allowed attachments send and download byte-identically through both
providers; authorization, size, MIME, filename, timeout, content-sniffing, and
malicious-file tests pass.

Direct download, original-attachment forwarding, and Download all implementation
plus automated security/browser coverage are complete. Download all uses a 30-second,
single-use connection/message-bound ticket, so the reusable mailbox-session
scope never appears in a native-download URL. JMAP downloads also support
standards-compliant unknown-length identity streams while retaining exact
verification whenever a length is known and the existing byte ceiling always.

Dedicated receiving-side acceptance completed on 2026-08-08 through isolated
live JMAP and IMAP/SMTP Veda Mail profiles connected to the Stalwart test
mailbox. Each adapter sent two deterministic files to itself, received them,
downloaded both through the authenticated endpoint, independently extracted the
Download all ZIP, forwarded the received message through the server-side import
path, and downloaded the two forwarded copies. Source, received, ZIP-entry and
forwarded SHA-256 values matched: IMAP text
`4f6a910ac2d9b77b7849e4b0985051c49e43dded1ca4e6f90185bd9ff9e571d8`,
JMAP text `46e5bcad583fb220f579518d3f63932f8aad00fcfde58014efcdfd8ddc732fae`,
and the shared binary fixture
`ecb206fd0de61128823e890f059dc0f0434a165ae082493dae2697c1b93fc7c8`.
All four direct/forward responses returned safe attachment disposition,
`private, no-store, no-transform, max-age=0`, `nosniff`, sandbox CSP,
same-origin CORP, no-referrer, and no byte ranges. The independent ZIP digests
were `3e3e6881744672505619669aef8836574765d8d3cd9e0b9b841d96e4e6b86279`
(IMAP) and `f3880998e67dfee2b2b94a7b106f4f03f066b13d3eedbe98590d4fcdec70dce9`
(JMAP). That first isolated acceptance used the deterministic clean-scanner
adapter; the independent real-ClamAV evidence below covers the scanner boundary.

The received-malware vertical slice is also implemented for direct and Download
all delivery: the exact known- or unknown-length provider stream enters an
AES-256-GCM, scope-bound, single-use spool; all entries must receive a complete
clean ClamAV verdict before any attachment or ZIP byte is emitted. Shared scan
concurrency and connect/idle/absolute/verdict deadlines fail closed. A pinned
`clamd.conf` blocks encrypted or limit-exceeded content and bounds expanded
archive bytes, recursion, files, parser work, CPU, memory, PIDs and temporary
storage. Unit, adversarial, route, browser, real JMAP/IMAP adapter and live
ClamAV nested/limit fixtures cover the implementation.

Production scanner deployment evidence is now recorded for merge
`e4261652eb81bf346902f41fee62fc089e6bd4c7` (PR #79). Dokploy deployed the
repository-backed `compose.yaml` from `main` with the release image
`ghcr.io/bestmaa/veda-mail:sha-e4261652eb81bf346902f41fee62fc089e6bd4c7`;
the corresponding scanned and attested multi-platform release digest is
`sha256:18b3ee45d7f5685f3bd7238c3f79cbf29ddcda4d9cecc198df7b9857ca513581`.
Both the Veda Mail and ClamAV containers reported healthy on 2026-08-04. The
application retained the named `veda-mail-data` volume at `/data`; ClamAV used
the read-only Dokploy-managed `clamd.conf` bind and its named signature volume.
The public sign-in surface loaded successfully.

Dedicated real-ClamAV acceptance completed on 2026-08-08 against the exact
production release `240f5ed70d38943e83865e5e8f4305a19b41efb7` and an isolated
Standard IMAP/SMTP profile. Production JMAP and isolated IMAP both previewed
their known-clean 60-byte text fixture only after a real ClamAV verdict. Each
preview used a `blob:` URL in an iframe titled `Plain text attachment preview`
with exactly `sandbox="allow-same-origin"` and no script permission, and rendered
the exact source line. The binary fixture remained Download-only. Direct
downloads and independently inspected Download-all archives retained the
existing exact SHA-256 values: JMAP text
`46e5bcad583fb220f579518d3f63932f8aad00fcfde58014efcdfd8ddc732fae`,
IMAP text
`4f6a910ac2d9b77b7849e4b0985051c49e43dded1ca4e6f90185bd9ff9e571d8`,
and binary
`ecb206fd0de61128823e890f059dc0f0434a165ae082493dae2697c1b93fc7c8`.

The same dedicated account accepted an IMAP-appended EICAR fixture so both
receiving adapters could exercise the hostile provider-stream path rather than
only outbound upload quarantine. JMAP and IMAP direct download each failed
closed with the sanitized malware-blocked result and created no download. A
second message combined EICAR with a known-clean companion; Download all failed
closed through both adapters before emitting a ZIP. Outbound EICAR uploads were
also rejected while the clean control reached the ready state in both profiles.
The pinned ClamAV 1.5.3 sidecar's live integration suite passed clean/EICAR,
plain-text preview, nested-malware archive, and expanded-archive-limit cases
(2/2 tests). Production `/api/ready` independently reported both `data` and
`scanner` as `ok`. The two exact synthetic mailbox messages, isolated profile,
temporary quarantine data, scanner container, and signature volume were removed
after verification.

## M3 — Draft-safe, rich composing

- [x] Provider-backed create, update, list, open, and discard drafts
- [x] Provider-durable attachment autosave and saved-draft attachment sending
- [x] Debounced autosave with visible saving/saved/offline/error status
- [x] Restore an interrupted compose session without duplicating a draft
- [x] Safe rich-text editor v1: headings, emphasis, lists, isolated links,
  browser spellcheck, and an explicit plain-text mode. The server creates the
  readable plain alternative and removes scripts, event handlers, remote
  embeds, and arbitrary styles before either included provider sees content
- [x] Per-identity signatures with multiple named plain-text and
  sanitized-rich variants, explicit new/reply-forward defaults, and exact-once
  composer insertion
- [x] Reusable templates with explicit insert/replace behavior
- [x] Send confirmation preference and an undo-send delay backed by a durable
  queue
- [x] Complete the keyboard-shortcut and assistive-technology audit beyond v1
  browser spellcheck and standard formatting shortcuts

Acceptance: reloading or losing the network cannot silently lose a draft, and
the MIME message has equivalent readable HTML and plain-text parts.

Rich-text v1 meets the equivalent HTML/plain provider-send requirement.
The send-confirmation and Undo Send implementation is locally complete:
encrypted backward-compatible account preferences, exact provider-draft save,
5/10/20/30-second durable queue jobs, atomic pre-lease cancellation, global
countdown, exact draft restore, duplicate-submit locking, accessibility checks,
and JMAP/IMAP-portable browser coverage. The slice was merged in PR #63 as
`000e4bd`, and release run `30748850631` published
the scanned, attested amd64/arm64 image index
`sha256:79461c3a139473e0e65b9a2c32ddf4424ba7614a1a06e030f95a33c0f0d7d0d2`.
Its amd64 manifest is
`sha256:599bc0e5d6d2f98a162c67d0f8c861d8a9d58ace6fe5c7c0ba8c7aed4f3ff660`
and its arm64 manifest is
`sha256:f995524d9af0e0d8085616a398ac691cd8dde2ef50f6f0f3c8dff291f080c9c2`;
both carry the exact merge revision and repository source labels.

Production acceptance completed on 2026-08-07 after PRs #120 and #121. The
exact protected-main revision `3733693aca7b2dc22995e3b44fbc795aeaa2dae2` was
deployed from the scanned and attested image digest
`sha256:f38d3cbc836df41c31981ee46e070297804d5da3fe10e024b5747694d7018b8c`;
both `/api/health` and `/api/ready` returned 200. The live Stalwart mailbox
proved that Enter in an unresolved recipient field cannot bypass validation,
an already-autosaved provider draft can enter the durable 20-second window,
and cancellation atomically restores the exact subject and body. A Gmail
`in:anywhere` search proved the cancelled message was absent after the window.
The non-cancelled control completed once, appeared in Sent Items with the exact
recipient, and arrived at Gmail (classified as Spam), proving the positive
external-delivery path as well as the cancellation path. The temporary test
account preferences were then restored to immediate send without confirmation.

The keyboard and assistive-technology slice is locally complete: encrypted
opt-in preferences with backward migration, an accessible focus-trapped guide,
search/compose/list/reader commands, editable/composer/modal suppression,
rights-aware action reuse, `aria-keyshortcuts`, polite announcements, skip
navigation, reader focus handoff/return, narrow-screen preference scrolling,
and automated policy/component/browser accessibility coverage. Permanent delete
has no global shortcut. The slice was merged in PR #65 as `dcb6bc9`, and
release run `30754347225` published the scanned, attested amd64/arm64 image
index
`sha256:8706ba16583433eec494290f941acfcb52e427d903b6e901ed6fceeaa1721a84`.
Its amd64 manifest is
`sha256:a5cadfcd63dccf8ac8bef6a338f15a84baefd61764e85823d4da83f88e39e0df`
and its arm64 manifest is
`sha256:a219d04ceeba9186ef9a0c3d02799ee43a8a3fceb3054eb0ec182ede44dab32d`;
both carry the exact merge revision and repository source labels. Production
keyboard and assistive-technology acceptance completed on 2026-08-08 with the
dedicated live Stalwart mailbox. The shortcut guide exposed a named dialog,
announced the enabled state and complete command list, trapped focus, closed
with Escape, and returned focus to its exact trigger. The `/` command focused
mail search without inserting the key; typing then suppressed the `C` command.
Outside an editable field, `C` opened a single compose dialog and `J` opened the
next loaded message with focus on its subject heading. Escape closed the reader
and returned focus to the exact originating message button. The live controls
exposed `aria-keyshortcuts` for `?`, `/`, and `C`, and polite status messages
announced the completed actions. The temporary shortcut preference was restored
to its original disabled state after acceptance.
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
Production acceptance was completed on 2026-08-07 against the deployed
protected-main release. A dedicated Stalwart mailbox created a unique rich
template, reloaded the application, and recovered the same named template.
Insert preserved the current subject and appended the stored body; Replace
required the context-loss confirmation and then applied the exact stored
subject and body. The synthetic template and provider drafts were deleted
after verification. Public liveness and readiness both returned HTTP 200,
with the data and scanner readiness checks `ok`.

Provider-durable attachment production acceptance was completed on 2026-08-08
against the dedicated Stalwart mailbox. A unique 135-byte text attachment was
uploaded and reported `Saved`; after a fresh application reload, the provider
draft reopened with the same attachment name and size, no unsupported-content
warning, and an enabled Send action. The clean saved-draft send completed,
appeared in Veda Mail Sent Items with the attachment, and arrived in the
recipient Gmail inbox marked as having that attachment. Stalwart compatibility
fixes were merged through PRs #125, #126, and #127. The final protected-main
release was commit `4eca729d173664cc4e0117c1035d26a1429764d6`, deployed from
the scanned and attested multi-platform image digest
`sha256:9d93373e68e4010b3012589c88e461f13b915f1561fc2f6d9553eebb28136afd`.
Public liveness returned `ok`; readiness returned `ready` with data and scanner
checks `ok`. All five known synthetic provider drafts were matched by exact
test subject, deleted, and followed by a provider query reporting zero drafts.
The earlier
`wovvtec.site`/`mail.wovvtec.site` NXDOMAIN entry used
incorrect hostnames; the canonical deployment endpoints are
`panel.wovvtech.site` and `webmail.vedaconcepts.com`, and public webmail health
was HTTP 200 on 2026-08-03.

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

- [x] Provider-backed conversation/thread view with deterministic fallback
- [x] Reply/forward placement, quoted-content collapsing, and per-message details
- [x] Search grammar for from, to, cc, subject, body, dates, size, attachment,
  unread, starred, mailbox, and exact phrases
- [x] Search suggestions, recent searches, clear active-filter chips, and
  shareable URL state without leaking credentials
- [x] Saved searches or virtual mailboxes
- [x] Print-friendly message/conversation view

Acceptance: thread membership and search semantics have provider contract tests;
unsupported predicates are reported rather than silently ignored.

Saved searches are provider-neutral canonical queries rather than stored
provider identifiers. The member API reparses every query server-side, applies
bounded name/query/book/request limits, enforces same-origin and live browser
session scope, and uses optimistic revisions to reject stale-tab overwrites.
Books are isolated by provider and account identity, encrypted at rest with
AES-256-GCM keys derived from the installation secret, authenticated with an
owner-bound AAD value, and fail closed on tampering. The accessible header
manager saves, reloads, replays through the existing typed JMAP/IMAP search
contract, and deletes searches. Unit, route, client, full coverage, production
build, dependency audit, and browser save/reload/replay/delete regressions pass.

Print-friendly message and full-conversation views reuse only the portable
`getMessage`/`getConversation` contracts, so JMAP and IMAP/SMTP remain feature
equivalent. A same-origin, session-scoped POST prepares a private no-store
document, limits each conversation to 100 unique messages, eight provider
pages, four concurrent detail reads, and four preparations per member per
minute, and fails closed on provider anchor, cursor, or message-ID mismatch.
Provider HTML is sanitized again at the print boundary with all inline/remote
images removed; executable content, attachment bytes/links, provider cursors,
raw headers, and credentials never enter the print DOM. The print-only portal
includes portable From/To/CC/Reply-To/date/size and attachment metadata,
preserves page breaks and long-message pagination, reports safe-limit
truncation, invokes the native print dialog, and is hidden from the interactive
accessibility tree. Unit, integration, component, architecture, and browser
regressions cover both single-message and complete-conversation flows.

The conversation vertical slice is locally complete. Stalwart resolves the
authenticated anchor before using exact `Thread/get` membership. IMAP prefers
an exact native thread identifier and otherwise follows a bounded, cycle-safe,
post-verified Message-ID/In-Reply-To/References graph across readable
mailboxes; it never groups by subject. Both adapters return 25-message pages,
cap verified membership at 100, de-duplicate provider identities, and use
deterministic chronological ordering. Signed connection/anchor-bound and
membership-snapshot-bound cursors, dedicated rate limits, 64-KiB reply-header
limits, stable loaded-page navigation, selected-message mailbox rights,
strict route validation, sanitized failures, unit/provider-contract/component,
and browser regressions cover the slice. Authenticated production JMAP
acceptance proved a two-message Provider thread in chronological order, exact
selected-message switching, and the selected-message action group. Dedicated
live Stalwart IMAP acceptance then exposed a provider that returned no HEADER
or TEXT search hits despite correct Message-ID, In-Reply-To, and References
headers. The released fallback scans one anchor-centred sequence window within
the existing 100-message budget, post-verifies the identifier graph, never
groups by subject, and reports truncation when the mailbox exceeds the window.
The exact two-message fixture returned `references`, total 2, root then reply,
and `truncated: false`; both verified synthetic messages were deleted afterward.
PR #132 was squash-merged as
`53b4ceb2486eb43312dbba81d666f8641f698571`. Its scanned and attested
amd64/arm64 release digest
`sha256:b34d437a06cc94ecde6358e7d98395395f96bb5988dc925b90101679cd4a6822`
was pinned and deployed through Dokploy. The Veda Mail and ClamAV containers
were healthy, `/api/health` returned `ok`, and `/api/ready` returned `ok` for
both data and scanner on 2026-08-08.

The selected-message reader follow-up is locally complete. Reply, Reply All,
and Forward remain bound to the exact expanded message and sit in an explicitly
labelled action group. A native disclosure exposes normalized portable message
details, while plain reply/forward markers and sanitized HTML blockquotes are
collapsed only in presentation and can always be restored. Raw headers,
provider identifiers, and hidden message mutation are outside this surface.
Unit, component, and browser coverage protects quote recognition, sandbox/CSP
isolation, accessibility state, conversation position, and narrow-screen use.
Authenticated production acceptance selected the root and reply independently,
verified the exact Reply, Reply all, and Forward action group, expanded portable
From/To/Date/Size/Attachments/conversation-position details, and restored a
collapsed quoted reply through `Show quoted content`. The immutable release and
production health evidence above close this follow-up together with the
provider-backed conversation slice.

The advanced-search slice is locally complete: the bounded AND grammar covers
addresses, subject/body/text phrases, inclusive/exclusive protocol dates, strict
binary sizes, attachment, read/star state, and authenticated mailbox-name/role
resolution. JMAP receives a typed AND filter; IMAP intersects repeated-key
SEARCH batches and reports its unsupported attachment predicate with HTTP 422.
The accessible UI adds session-memory suggestions/history, removable active
chips, client/server validation, and credential-free fragment URL restoration.
Unit, route, provider-contract, component, and browser tests cover the slice.
PR #68 was merged as `b51084d37ee960e8deb63662c924489712217b21`; immutable
image digest
`sha256:2657d1e9ea53fd56a16316eac52c162f6a6a4d69e7590733b9c8fea254769bd3`
was deployed on 2026-08-03 and the public `/api/health` endpoint returned HTTP
200. An authenticated production query for the exact newly delivered subject
plus `in:sent` returned one message and exposed both removable filter chips,
closing the two search checkboxes. See [Advanced mail
search](./ADVANCED-SEARCH.md).

## M6 — Rules and productivity

- [x] Server-side filters/rules: match sender, recipient, subject, headers,
  size, or attachment; then move, label, star, mark read, or discard
- [x] Rule ordering, enable/disable, dry-run preview, conflict handling, and
  audit history
- [x] Scheduled send using an encrypted durable queue, retry policy,
  cancellation, clock/time-zone handling, and idempotency keys
- [x] Snooze with durable wake-up scheduling and mailbox restoration
- [x] Contacts, recent-recipient ranking, autocomplete, groups, and vCard
  import/export
- [x] RFC 5545 calendar invitation display, accept/maybe/decline, and `.ics`
  import/export; CalDAV integration remains capability-gated
- [ ] Vacation responder and delegation only where the provider advertises them

Acceptance: restart, duplicate-delivery, daylight-saving, and provider-outage
tests prove scheduled work is not lost or executed twice.

Status: the filters/rules v1 implementation is released. Rules use
provider-native Sieve through JMAP or TLS-protected ManageSieve, an encrypted
owner-isolated intent/audit store, revision conflict checks, deterministic
owned-script signing, capability gating, and a bounded exact-semantics dry-run
preview. JMAP and IMAP preview paths, rule ordering, enable/disable, all listed
conditions/actions, conflict handling, lost-response recovery, foreign-script
protection, credential erasure, UI flows, routes, and provider adapters are
covered by unit, integration, component, architecture, production-build, and
security gates. PR #86 fixed Stalwart's canonical post-activation Sieve blob
confirmation and was squash-merged as
`0c22a7f75baef98296c1c69b42d6b6bb72a4fb77`. Production deployed that revision;
authenticated JMAP evidence confirmed reconcile, deployment, a server-side
mark-as-read delivery, and safe removal of the test rule on 2026-08-05.
On 2026-08-09 the deployed Stalwart container was independently confirmed to
listen on 4190 and advertise STARTTLS plus the required Sieve extensions, while
the compose contract also published `4190:4190`. The public TCP path remained
filtered, so no script or mailbox was mutated and the checkboxes remain open.
Transport hardening now directly covers fragmented lines/literals, direct TLS,
STARTTLS, certificate/setup failure cleanup, timeouts, response limits, command
injection, unsafe DNS answers, capability failure, missing extensions, provider
drift, ambiguous active scripts, and rejected CHECK/PUT/activation operations.
An isolated Stalwart 0.16.15 wire acceptance on 2026-08-10 then reproduced the
remaining consecutive-save conflict: Stalwart correctly reissued its capability
greeting after STARTTLS, but the client left that greeting queued and shifted
every subsequent response by one command. The transport now consumes and
validates that RFC 5804 greeting before discovery. A regression proves the next
deliberately rejected command remains aligned, and two isolated authenticated
connections read the installed script with the same byte length and SHA-256.
On 2026-08-11 a source-IP-restricted provider path exposed a second wire-level
gap: synchronizing `CHECKSCRIPT` literals did not include the RFC 5804 command
terminator, so the real server waited until timeout. A transport regression now
requires that terminator. An isolated temporary Standard IMAP/SMTP account then
passed real STARTTLS capability/authentication, script check, upload, activation,
exact readback, and removal. The full Veda Mail acceptance also passed independent
SMTP delivery with server-side mark-read and star effects, ordering, disable and
enable, stale-revision conflict, bounded dry-run, redacted audit history, and exact
rule cleanup. The isolated account and its messages were deleted after verification;
no production user script or mailbox was changed. This closes both rules rows for
JMAP and generic ManageSieve providers within their advertised capabilities.

The provider-managed vacation-response slice is implemented for providers that
advertise RFC 8621 `urn:ietf:params:jmap:vacationresponse` on the writable
primary mail account, or Standard IMAP providers whose configured ManageSieve
endpoint advertises `vacation`, `date`, and `relational`. The strict member
route uses exact mailbox-session scope,
same-origin writes, bounded UTC dates and bodies, provider-state concurrency,
subject rate limits, and metadata-only security audit events. Account settings
show the automatic-reply form only when supported and explicitly explain when
vacation response or mail delegation is unavailable. Standard IMAP composes
rules and vacation inside the single HMAC-owned script, preserves each half
across updates to the other, uses independent logical revisions plus a complete
script drift snapshot, validates with `CHECKSCRIPT`, and requires exact
post-activation readback. Signed chunked metadata enables exact reloads; dated
guards and deterministic base64 multipart HTML remain injection-safe. On
2026-08-12 a disposable pinned Stalwart 0.16.15 server and temporary account
advertised the required extensions and accepted a real STARTTLS ManageSieve
dated HTML composite through `CHECKSCRIPT`, upload, activation, exact reload,
and disable. The account, active script, container, and exact named volumes were
then removed. The source-IP-restricted production runner now covers the same
vacation round trip alongside rules and remains the deployment acceptance gate.
Current Stalwart sharing documentation advertises calendar, address-book, and
file sharing, not mail delegation, so delegation is not invented or
over-advertised and keeps this combined checkbox open.

The provider-independent Snooze slice is released and deployed. It persists a
unique owned mailbox intent before provider mutation, encrypts owner-scoped jobs
and current provider credentials beneath `VEDA_MAIL_JOB_KEY`, commits durable
random leases, and reconciles interrupted hide/wake operations without
delivery-style `uncertain`. JMAP preserves unrelated mailbox memberships and
keywords through state-conditioned patches. Standard IMAP requires MOVE,
UIDPLUS, verified
wildcard keywords, UIDVALIDITY, and a unique recovery marker; ambiguous source,
target, or lost-response state fails closed. Owner keys include a stable
provider-account scope, terminal/authentication outcomes erase credentials, and
the accessible UI supports reader/bulk snooze, local-time presets, partial
rollback, Restore now, Change time, and Retry. PR #84 was merged as
`b294da8d4b898ed94e1db9762b9795046da179d0`; release run `30941780940`
published the scanned, attested amd64/arm64 image index
`sha256:50b16d35ded7c6888228fda5d5589112a669680a6e14fbd59ed05eec445048cb`.
Dokploy deployed that exact Git revision from `main`, then aligned
`VEDA_MAIL_IMAGE` to the immutable SHA tag and completed a second deployment.
Both the Veda Mail and ClamAV containers reported healthy on 2026-08-04, and
the public `/api/health` endpoint returned HTTP 200 with `status: ok`. On
2026-08-11 the dedicated mailbox completed the remaining Standard IMAP/SMTP
acceptance through an isolated production build, installation, data directory,
and job key. A unique self-delivered message moved from INBOX into the owned
Snoozed mailbox, and its encrypted job plus exact 18:00 Asia/Calcutta return
time survived a full application-process stop and restart. Before the deadline
the message remained absent from INBOX; after it, refresh produced one restored
INBOX copy, the durable manager reported no snoozed messages, and the owned
Snoozed mailbox was empty. The exact INBOX and Sent fixtures were then moved to
Trash, permanently deleted, and verified absent; the isolated installation was
destroyed. Together with the existing JMAP evidence and automated duplicate,
reconciliation, outage, time-zone, route, component, and provider-path tests,
this closes Snooze.

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
Production now has the external scheduled-job key and canonical public URL,
and the implementation is deployed in release
`e4261652eb81bf346902f41fee62fc089e6bd4c7`. On 2026-08-11 the dedicated test
mailbox passed authenticated production JMAP cancellation and restart
acceptance. A queued self-delivery survived an application-container restart,
left the encrypted queue after recovery, and appeared exactly once in both
Inbox and Sent. A separate cancelled job reopened its provider draft without
delivery. The same mailbox then passed the equivalent Standard IMAP/SMTP flow
through an isolated production build with a separate installation, data
directory, and job key: the process was stopped completely, restarted against
the same encrypted store, and delivered exactly one SMTP/IMAP copy after the
scheduled instant. Both provider queues drained, all exact synthetic messages
were permanently removed, no acceptance job or draft remained, and the
isolated installation was destroyed. Together with the existing retry,
dead-letter, uncertainty, clock/time-zone, idempotency, route, component, and
provider-path tests, this closes scheduled send. The earlier NXDOMAIN note used
incorrect `wovvtec.site` hostnames; the canonical panel is
`panel.wovvtech.site` and public webmail is `webmail.vedaconcepts.com`.

The provider-independent Contacts slice is released and deployed. Each authenticated
JMAP or IMAP/SMTP identity receives an encrypted, owner-isolated address book
with bounded contacts and groups, optimistic revisions, delivery-confirmed
recent-recipient ranking, accessible To/CC/BCC autocomplete, and vCard 3.0/4.0
import/export. Accepted delivery records all unique recipients, partial delivery
excludes provider-rejected recipients, and uncertain delivery records nothing;
address-book persistence failure never changes a provider-confirmed send into a
retry. Strict route, store-tamper, mutation, ranking, component, session-scope,
and hostile-vCard tests cover the implementation. It merged in PR #81 and is
deployed in production commit `12d748a2e9e4f6efdcb051fd84238a2be701b3bf`.
On 2026-08-12 the dedicated production JMAP mailbox and a separate isolated
Standard IMAP/SMTP installation completed the remaining live acceptance. In
each provider mode, a unique contact and one-member group survived a full page
reload and appeared through accessible compose autocomplete. A hostile-input
boundary-safe vCard 4.0 fixture imported a second contact and group, and the
downloaded export contained both exact contacts, their email addresses, group
categories, and generated UIDs. A uniquely named self-delivery then completed
successfully and appeared in Recents with the exact recipient identity and
confirmed-use count. All exact contact, group, recent-recipient, mailbox-message,
download, and upload fixtures were removed afterward; the isolated installation
and data directory were destroyed. Together with the existing strict route,
store-tamper, mutation, ranking, component, session-scope, provider-path, and
hostile-vCard tests, this closes Contacts.

The provider-independent RFC 5545 calendar slice is released and deployed. JMAP and
IMAP discover bounded `text/calendar` body parts without exposing provider blob,
section, or UIDVALIDITY identifiers; exact parts are re-fetched, malware-scanned,
and parsed as hostile input. The reader displays REQUEST, CANCEL, REPLY, and
PUBLISH metadata, explicitly warns when sender and organizer differ, and offers
Accept/Maybe/Decline only when the authenticated account is the unique invited
attendee. SMTP and JMAP emit canonical `METHOD:REPLY` iMIP parts with scoped send
idempotency. A Veda-local, owner-isolated encrypted event book supports strict
single-event import and deterministic whole-book `.ics` export. Parser,
serializer, store-tamper, route, provider, MIME, and accessible component tests
cover the slice. CalDAV remains capability-gated and no remote calendar URI is
fetched. It merged in PR #82 and is deployed in production commit
`6a1bfd9c8247514e1ab4057375e6340fe647e499`. On 2026-08-12 separate isolated
Veda installations connected the dedicated real-provider mailbox through
Stalwart JMAP and Standard IMAP/SMTP and completed the remaining live
acceptance. In each mode, a canonical self-addressed `METHOD:REQUEST` rendered
the exact sequence, UTC interval, location, organizer, and invited-attendee
actions; Accept emitted a provider-delivered response that appeared in Inbox
and Sent, and Add to calendar persisted the exact event. The downloaded
whole-book `.ics` export preserved the unique UID, summary, sequence, interval,
description, location, organizer, and attendee. All exact request, response,
temporary draft, upload, download, and calendar fixtures were permanently
removed afterward, both isolated processes were stopped, and both data
directories were destroyed. Together with the parser, serializer, encrypted
store, route, provider, MIME, component, and browser suites, this closes the RFC
5545 invitation slice; CalDAV remains capability-gated.

## M7 — Notifications, offline resilience, and accessibility

- [x] New-mail refresh using JMAP events/push where available and bounded polling
  fallback for IMAP
- [x] In-app and opt-in Web Notifications with privacy-safe content controls
- [x] PWA installability and an explicitly bounded offline cache
- [x] Network reconnection, stale-state indicators, and safe retry behavior
- [ ] WCAG 2.2 AA keyboard, focus, contrast, zoom/reflow, motion, and
  screen-reader audit
- [x] Localization foundation, locale-aware dates/numbers, RTL layout, and
  selectable time zone

Acceptance: notification permissions are never coerced, private message content
is not cached by default, and the primary flows pass automated and manual
assistive-technology checks.

Provider-independent live mailbox refresh is released through PRs #87 and #88
and remains in production commit
`3639de03de0c7535dea1aa150b085f7d0f1a8cf2`. Stalwart consumes a bounded,
same-origin JMAP event source for Email and Mailbox state; quiet 55-second waits
force an authoritative reconciliation, while untrusted or unavailable event
sources fail over to the same 60-second polling contract used by standard
IMAP/SMTP. One scoped client loop pauses offline and normally while hidden,
coalesces provider waits, caps failure backoff, and never exposes credentials or
provider state tokens. Unit, route, provider, and browser regressions cover
single-flight waits, session expiry, event bounds, cross-origin rejection,
quiet reconciliation, hidden/offline behavior, and delayed polling. The
dedicated JMAP mailbox received `VEDA-FINAL-JMAP-RECONCILE-2026-08-05-0733`
through the deployed event/reconcile path without manual refresh. Independent
production SMTP/TLS delivery to the dedicated test account was then discovered
through read-only IMAP/TLS at the first 60-second poll as
`VEDA-IMAP-POLL-LIVE-20260805-161156` (61.331 seconds end to end).

The privacy-safe notification slice is released and deployed in production
commit `fd8353fa3761904b9b5f32507de6f0114d02223a` through PR #89. A direct
production session showed browser permission remaining untouched through load
and settings display, then entering the request state only after the explicit
Enable action. The dedicated JMAP test mailbox received
`VEDA-NOTIFICATION-LIVE-2026-08-05-0824` from an independent tab without manual
refresh and rendered the accessible, dismissible generic notice “New mail in
Veda Mail / You have a new message.” while the real subject remained confined
to the Inbox. Unit regressions exercise granted Web Notification construction,
generic/detail content policy, account-isolated tamper-resistant preferences,
permission gesture gating, hidden-tab subscriptions, and storage/constructor
failure containment. Component checks cover the live UI's privacy explanation,
recommended default, status semantics, and dismiss action. The browser-control
environment cannot accept Chrome's native operating-system permission bubble;
the granted constructor path is therefore deterministic automated evidence,
while the deployed UI provides the manual opt-in path. Closed-browser delivery
remains out of scope until the separate PWA/Web Push milestone.

The bounded PWA slice is released through PR #91 and deployed in production
commit `669542b837f39fbab6195072fc543501347dc85e`. The live domain returned a
standalone, root-scoped manifest and a root-authorized worker with
`no-cache, no-store, must-revalidate`; health remained `ok`, and the dedicated
Stalwart mailbox signed in after the deployment restart. Production-browser
verification registered the worker, disabled the network, loaded the generic
offline document, and inspected an exact four-entry Cache Storage inventory:
offline HTML/CSS plus 192 px and 512 px public icons. Unit regressions prove
that APIs are not intercepted, stale cleanup is namespace-bounded, and only
those public assets are precached. Authenticated documents, messages,
attachments, application chunks, cross-origin requests, and non-GET traffic
remain outside the worker cache.

The connectivity-recovery slice is released through PR #93 and deployed in
production commit `c56a3611b1fbf93626c4e4c29ecac4c881c6e05e`. Browser
online/offline events now label only the exact accepted snapshot, and one
single-flight authoritative read reconciles online transitions, manual
refreshes, retries, and transient provider-update gaps without replaying any
write. Unit and component regressions cover state transitions, offline request
suppression, duplicate-event coalescing, status semantics, and the bounded
update-loop refresh. Production-build Playwright evidence disables and restores
the browser network, preserves known mail while stale, proves only one request
for repeated refresh actions, exposes an actionable failed-recovery state, and
successfully retries. Full CI, CodeQL, container/source scanning, live ClamAV,
production build, and security-header checks passed. Dokploy recorded the exact
commit as done in 1m 10s; the live health endpoint returned `ok` with private
no-store and transport/security headers, and the dedicated Stalwart JMAP test
mailbox signed in, retained its Inbox, and completed an authoritative manual
refresh without a stale alert.

The automated accessibility-audit slice is released through PR #95 and deployed
in production commit `73ad20e0c54fe2207b78e816d099de1184f7f421`. CI now rejects
all axe violations in the WCAG 2.0, 2.1, and 2.2 A/AA rule sets across sign-in,
mailbox, reader, compose, and account settings. Browser regressions additionally
prove 320 CSS-pixel reflow, visible keyboard focus, 24 CSS-pixel targets,
reduced motion, forced-colors focus, and accessible branding contrast. The live
Stalwart test mailbox loaded after the 1m 19s Dokploy rollout; activating the
skip link with Enter moved focus to the Inbox heading and retained a visible
2px focus ring. The public health endpoint returned `ok` with private no-store
and transport/security headers. The checkbox remains open until deployed NVDA
with Chrome, VoiceOver with Safari, and manual Windows forced-colors acceptance
are executed and recorded in `docs/ACCESSIBILITY.md`.

The provider-independent localization foundation is released through PR #97
and deployed in production commit
`3639de03de0c7535dea1aa150b085f7d0f1a8cf2`. Encrypted owner-isolated
preferences now select `en-IN`, `hi-IN`, or Arabic formatting and either the
browser zone or a runtime-valid IANA zone for JMAP and IMAP/SMTP accounts.
Dates, numbers, attachment sizes, rules previews, scheduled send, and Snooze
share the accepted locale and zone; chosen wall-clock job times resolve to UTC
and reject nonexistent daylight-saving times. Arabic enables RTL flow and
Arabic-Indic digits while the untranslated English source catalog truthfully
keeps `lang=en`. CI passed quality, coverage, all 91 browser regressions,
production build/header checks, dependency audit, CodeQL, live ClamAV, and
source/container scanning. Dokploy deployed the exact merge in 1m 8s; public
health returned HTTP 200 `ok` with private no-store and transport/security
headers. The dedicated Stalwart account saved Arabic with `Asia/Riyadh`, showed
RTL flow plus Arabic-Indic counts and dates without desktop overflow, retained
the setting after reload, and was restored to `en-IN` with automatic time zone.
Automated browser evidence separately proves 320 CSS-pixel RTL reflow.

## M8 — Administration, operations, and trust

- [x] Admin feature/capability matrix and per-organization policy controls
- [x] Configurable message/attachment limits and allowed/blocked file policy
- [x] Optional open-source malware scanner integration with quarantine states
- [x] Structured redacted logs, request correlation, metrics, health/readiness,
  provider latency/error dashboards, and alerting guidance
- [x] Security audit log for administrator, authentication, rule, delegation,
  export, and destructive mailbox actions
- [x] Session inventory/revocation, idle/absolute expiry, CSRF review, login
  throttling, and distributed rate-limit option
- [ ] Encrypted shared session and job repositories for multi-replica operation
- [ ] Export/import of settings, contacts, rules, and mail in standard formats
- [ ] Backup/restore drill, data-retention controls, privacy documentation,
  threat model, SBOM, provenance, dependency policy, and release checklist

Acceptance: a clean installation, upgrade, rollback, backup restore, replica
restart, and provider outage are exercised from documented runbooks.

Mail portability includes a bounded, audited single-message RFC 5322 `.eml`
export for both JMAP and standard IMAP/SMTP accounts. Settings/rule portability
now exports and explicitly replaces a strict 128-KiB versioned JSON file:
preferences remain provider-neutral, while rule mailbox/label IDs become
standard roles, bounded folder paths, and label names that are resolved
fail-closed in the destination account before the ordinary provider CAS
deployment. Contacts already use vCard 4.0. Bulk mailbox export/import, plus
the remaining member data classes, are still required before the M8 checkbox
can close.

The administration capability matrix and organization policy controls shipped
through PR #100 in production commit
`6d5b089cfa136f3b10e630818836983c757489cf`. Provider support is intersected
with organization policy for member profile edits, mailbox password changes,
and new Veda TOTP enrollment, and every restricted member route enforces the
effective policy server-side. The strict versioned policy record is stored in a
separate mode-0600 file with serialized atomic replacement so rollback to the
previous strict installation parser remains safe. Protected-main run
`31037503445` passed quality, coverage, all 103 browser regressions, production
build/header checks, dependency audit, CodeQL, live ClamAV, and multi-platform
source/container publishing. Dokploy deployed that exact merge successfully in
1m 10s; the public health endpoint returned HTTP 200 `ok` with private no-store,
HSTS, and nosniff headers, while the live administration route retained its
encrypted HttpOnly administrator-session gate.

Configurable organization message and attachment limits plus allowed/blocked
extension and detected-MIME policies shipped through PR #102 in production
commit `4907a07f40c78faac29d84ab15eed99d6e0421d1`. The rollback-safe versioned
mode-0600 policy record preserves prior defaults when absent, normalizes and
validates bounded rule lists, gives block rules precedence, and applies the
strictest provider or organization file limit. Enforcement covers uploads,
imports, provider draft attachments, immediate delivery, and scheduled
delivery, including fail-closed handling for unknown saved-attachment sizes
and retry-safe claim release when policy changes. PR run `31071553310` and
protected-main run `31072579608` passed quality, coverage, all 104 browser
regressions, production build/header checks, dependency audit, CodeQL, live
ClamAV, source/container security, and multi-platform publication; coverage
reported 73.06% lines, 70.32% statements, 67.25% functions, and 62.64%
branches. Dokploy deployed the exact merge successfully in 2m 18s, and the
post-deploy health endpoint returned HTTP 200 `ok` with private no-store,
HSTS, and nosniff headers. The live administration route continued to enforce
its encrypted HttpOnly administrator-session gate; authenticated policy-form
persistence and accessibility are covered by the passing browser regression.

The open-source malware-scanner hook and quarantine lifecycle are complete.
PR #20 (`948c265`) introduced the bounded scanner interface, AES-256-GCM
outbound quarantine, and explicit `reserved`, `uploading`, `quarantined`,
`clean`, `rejected`, `claimed`, and `consumed` lifecycle states; PR #55
(`b27e27c`) extended the same fail-closed inspection model to received
attachment downloads. The hook is replaceable for self-hosters, while
production attachment operations
never bypass inspection: an absent, busy, timed-out, incomplete, or invalid
scanner verdict returns a sanitized failure. Pinned `clamd.conf` limits bound
archive expansion, recursion, files, parser work, temporary storage, and
encrypted-member handling. PR #79 (`e426165`) and evidence PR #80 (`404afdc`)
shipped the immutable private ClamAV sidecar, read-only policy mount, and named
signature volume. The latest protected-main run `31072579608` and evidence run
`31074901730` passed the live ClamAV fixtures plus source/container security;
the focused scheduler, verdict, timeout, adversarial, and state-machine audit
passed all 42 tests. After the current production deployment, Dokploy reported
both `veda-mail` and `clamav` running and healthy, and the public health endpoint
remained HTTP 200 `ok` with private no-store, HSTS, and nosniff headers.

Privacy-bounded observability shipped through PR #105 in production commit
`2292f95b021065445ceabe698ad70001bf56154a`. Every API request now receives a
validated correlation identifier, while one-line structured logs allow only
bounded operational fields and replace dynamic route identifiers with `:id`.
Provider-independent gateway timing and outcome counters feed an optional
constant-time bearer-protected Prometheus endpoint; metrics stay hidden when
unconfigured. The readiness endpoint checks the data repository and exact
ClamAV `PONG` response without exposing paths, hosts, or raw errors. The
observability runbook supplies replica-safe Grafana queries, sustained alert
thresholds, retention guidance, and strict label/cardinality rules. PR run
`31081172416` and protected-main run `31089116705` passed quality and coverage
(483 files and 2,395 tests), all 103 browser regressions, production build and
security smoke, dependency audit, CodeQL, live ClamAV, source/container scans,
amd64 and arm64 builds, Trivy validation, attestation, and multi-platform
publication. Dokploy deployed that exact merge in 1m 7s. Production returned
HTTP 200 `ok` with a generated and caller-echoed `x-request-id`; readiness
returned HTTP 200 with both `data` and `scanner` `ok`; the unconfigured metrics
endpoint returned private, non-cacheable HTTP 404. The new Veda Mail container
and the ClamAV sidecar both reported healthy after deployment.

The tamper-evident security audit slice shipped through PR #113 in production
commit `4980ff766453258f89d162e03ecbc3db7aeb390c`. A serialized, atomic,
mode-0600 record store authenticates both the complete bounded snapshot and an
HMAC-linked sequence, derives separate integrity and pseudonymization keys from
the deployment job key, and fails closed before protected mutations when a
durable attempt cannot be recorded. Raw usernames, addresses, provider IDs,
message or mailbox IDs, content, IP addresses, and user agents are excluded;
the administrator API returns only verified, bounded, newest-first evidence.
Authentication, setup, administrator policy and account changes, user
provisioning, TOTP changes, rules, contact/calendar exports and imports,
mailbox emptying, and permanent message destruction record explicit attempt,
success, partial, or failure outcomes. Delegation action names are reserved but
not claimed until the separate delegation feature exists. PR run `31110776697`
passed quality, coverage, all 96 browser regressions, production build and
security-header verification, dependency audit, CodeQL, live ClamAV, and
source/container scans. Dokploy deployed that exact merge in 1m 8s; production
health returned `ok`, readiness returned both `data` and `scanner` `ok`, and
the live audit endpoint rejected an unauthenticated request with the bounded
`ADMIN_UNAUTHORIZED` response. The passing browser regression proves the
authenticated Audit log view, chain-verification banner, login event, privacy
redaction, and WCAG contrast on the deployed source revision.

The session-security slice adds server-registered administrator and mailbox
sessions with selective revocation, a 30-minute idle deadline, and a
non-extendable 12-hour absolute deadline. Administrator Security and member
Account settings expose privacy-safe session inventories without returning raw
cookies, provider credentials, email addresses, IP addresses, or user-agent
strings. Mutation CSRF checks now require either an exact Origin or trustworthy
same-origin fetch metadata. Login throttles remain protected by local limits
and can additionally use an atomic Redis fixed-window backend with HMAC-derived
keys; a configured but unavailable shared backend fails authentication closed.
Unit, integration, live-Redis concurrency, component, accessibility, provider,
architecture, build, dependency-audit, and browser regression coverage protect
the slice. Sessions and non-login mutable repositories remain explicitly
single-replica until the later shared-state roadmap item is delivered.

The session-security and immutable-Compose hardening is released and deployed.
PRs #115 and #117 shipped the session slice and stabilized its hosted browser
evidence; PR #118 removed the application build from the production Compose
definition and added an explicit source-build override plus a shared local/CI
contract verifier. Protected-main run `31151325373` passed quality and coverage
(494 files and 2,436 tests), all 105 browser regressions, production build and
security-header verification, dependency audit, CodeQL, live ClamAV, source
and container scans, amd64/arm64 image validation, attestation, and signed
multi-platform publication for commit
`d9f490d63856f9e01b94ae59b10e0a3a0a1a3f2f`. Dokploy pulled, rather than
built, the exact immutable release
`ghcr.io/bestmaa/veda-mail:sha-d9f490d63856f9e01b94ae59b10e0a3a0a1a3f2f@sha256:ab7df159aeeef37b3df84c02a7b87e22d8b54e3b26be6e73ad95ffe0be6bd7d8`
and completed the rollout in 31 seconds. Both containers reported healthy;
public liveness and readiness returned HTTP 200 with data and scanner checks
`ok`; HSTS, frame-denial, content-type, and permissions-policy headers remained
present. A fresh dedicated-mailbox session sent unique-subject evidence to an
external Gmail recipient, the message appeared in Sent Items, and Gmail
received it. The Account settings session inventory also exposed the current
browser, idle/absolute expiry policy, and selective revocation control without
returning raw session secrets.

## Delivery order

Work proceeds in small vertical slices. For every checkbox: contract and threat
review, implementation, focused tests, full quality gates, documentation,
container publication, deployment, and production verification happen before
the next slice is marked complete. If a provider cannot implement a feature,
its manifest must state that limitation and the UI must disable it with a clear
explanation.
