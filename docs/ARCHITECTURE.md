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

Mailbox provisioning uses a separate optional
`MailUserAdministrationPort`; it is never added to the member `MailGateway`.
Only the Stalwart adapter implements this port. A server resolver reads
`VEDA_MAIL_STALWART_MANAGEMENT_API_KEY` from the process environment and
requires its exact `VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN` binding to match the
active profile before the key reaches any request. It returns only an
available/unconfigured/unsupported status to the browser. The key is not part
of `installation.json`.

The adapter discovers `/.well-known/jmap`, revalidates the configured HTTPS
origin and advertised same-origin `apiUrl`, requires `urn:stalwart:jmap`, and
uses only typed Domain, Account, Authentication, and Action calls. Every
operation re-resolves a browser-selected domain against the profile's
normalized allowed-domain set. Provider records are projected into a safe DTO;
credentials, roles, permissions, groups, and unknown fields never cross the
infrastructure boundary.

Account creation requires Veda administrator password/2FA step-up. A durable,
bounded, atomic `0600` idempotency ledger records a keyed intent fingerprint
and safe terminal result for 24 hours. It never records the initial mailbox
password or a password-derived verifier. Expired safe metadata is removed on
the next provisioning access. A persisted pending entry after a crash is
treated as an uncertain outcome and blocks a blind provider retry. The
API distinguishes a replay from a fresh creation so the UI never claims that
a newly re-entered password replaced the first attempt's password. The
profile revision verified during step-up is checked again before constructing
the adapter, so a concurrent provider edit aborts before any secret is sent.

The deterministic demo provider is registered only in development and test.
Production registries contain deployable providers only.
The included Standard IMAP + SMTP adapter covers providers that expose secure
password/app-password protocol access. OAuth-only vendors use the same
contracts through a vendor adapter.

## Message submission boundary

The browser submits a stable UUID draft ID, canonicalized to one lowercase key
at every attachment and send boundary, structured To, CC, and BCC addresses,
required plain `body`, optional rich `htmlBody`, and an optional opaque reply
message ID. Before provider access, the send route bounds the JSON body,
validates header fields, caps and deduplicates recipients, derives reply
headers from the provider-owned source, and charges both a message-rate window
and a 300-recipient-per-verified-connection one-minute window.

The client-side rich editor is built from version-pinned, MIT-licensed Lexical
0.44.0 modules. It emits semantic headings, emphasis, lists, and links, offers
an explicit plain-text mode, and inserts pasted or dropped content as plain
text only. Client filtering is a usability and defense-in-depth control, not a
trust boundary.

The server treats both body fields as untrusted. Each is capped at 256,000
characters and UTF-8 bytes and their combined budget is 512,000. When
`htmlBody` is present, one centralized outbound policy restricts it to
paragraphs, line breaks, two heading levels, emphasis/underline, ordered and
unordered lists, and isolated absolute `http`, `https`, or restricted
address-only `mailto` links. The policy rejects unsafe controls, malformed
Unicode, oversized link destinations, more than 1,000 elements, or nesting
beyond 32; scripts, forms, styles, event handlers, remote media, and
unsupported markup are discarded. It then derives the readable provider-bound
`body` from the canonical HTML instead of trusting the client fallback.

This canonical plain/HTML pair enters the idempotency fingerprint and the
provider-independent `SendMessageInput`. SMTP supplies Nodemailer `text` and
optional `html`, producing `multipart/alternative` inside
`multipart/mixed` when attachments exist. JMAP supplies matching
`bodyValues`, `textBody`, and `htmlBody`, or an explicit alternative nested
inside a mixed attachment body structure. Omitting `htmlBody` preserves the
plain-text-only provider shape.

The JMAP adapter uses structured address properties, reads decoded JSON through
a 16 MiB stream cap, and retains at most the first 100 provider-supplied
addresses in each To, CC, BCC, From, and Reply-To list. Sender-controlled address
and summary strings are truncated before validation so one oversized message
cannot fail the whole inbox batch. Detailed JMAP reads request at most 256,000
bytes per body value, retain at most 128 referenced values within a 256,000
character aggregate source budget, and independently cap final text and
sanitized HTML presentations at 256,000 characters with a visible truncation
marker. The IMAP/SMTP adapter keeps BCC in the SMTP envelope and out of delivered
MIME. It intersects Nodemailer's immediate rejected values with the validated
submitted set, case-insensitively and in submission order. No match means
accepted, a strict subset means partial delivery, and rejection of the complete
set becomes a safe domain error without provider text or cause.

Partial delivery follows the normal private Sent-copy append attempt and
returns only matched submitted addresses to the authenticated composer, which
presents a bounded warning against resending to everyone. Known
pre-submission SMTP setup, authentication, envelope, and message-construction
failures remain retryable behind a generic non-recipient-bearing error. A
timeout, socket/connection failure, or unknown rejection from the SMTP
`sendMail` boundary is terminal uncertain because the server may have accepted
the final DATA terminator; no normal Sent copy is appended in that case.

The HTTP boundary canonicalizes every provider receipt again. Only an explicit
accepted result with no rejections or a non-empty strict rejected subset is
trusted. Contradictory, malformed, oversized, or unrelated values become a
terminal uncertain receipt with locally generated opaque metadata. Attachments
are consumed for partial and uncertain outcomes to prevent a blind duplicate
submission; an explicit all-recipient rejection remains retryable.

Immediately after validation and rate charging, the route reserves
`connection ID + draft UUID` before attachment inspection, decryption, claim,
or provider access. Its SHA-256 fingerprint covers the exact post-validation
recipient buckets, order, names and addresses, subject, body, reply ID, and
attachment-ID order without additional case or Unicode normalization. For rich
mail, `body` is the server-derived plain alternative and `htmlBody` is the
server-canonicalized HTML. An identical concurrent request waits for its owner;
an identical completed request replays the same canonical terminal receipt
without touching attachments or the provider. Reusing the draft UUID for a
different fingerprint returns a conflict. Definitive pre-submission or
all-recipient failure releases the reservation.

The terminal entry is committed synchronously as soon as the canonical
provider receipt exists, before notice persistence or attachment cleanup can
await. Its non-sliding 30-minute TTL starts at completion and cannot outlive
the verified connection; pending work lives only until that connection
expires. Each pending entry reserves 512 KiB, then terminal completion replaces
that reservation with a conservative UTF-8/UTF-16 estimate while retaining the
complete bounded partial-recipient receipt. Limits are 64 pending, 900 total
entries, 32 MiB pending, and 48 MiB total per connection, plus 1,024 connection
buckets, 10,000 entries, and 256 MiB process-wide. No entry is evicted to admit
a send: exhausted capacity returns a retryable fail-closed error before
attachment or provider work.

Partial and uncertain receipts are copied into a connection-scoped, bounded
in-memory FIFO before the response is returned. The browser hydrates that queue
after an ordinary page reload and dismisses entries through an authenticated
same-origin endpoint; recipient data is not written to browser storage. Notice
identifiers are server-generated UUIDs and dismissals are idempotent. Each
connection retains at most 100 entries and uses an explicit overflow sentinel
when detail is compressed. Process-wide storage is additionally capped at 128
connection buckets, 2,000 notices, and an estimated 8 MiB. Oldest buckets are
compressed to a sentinel under count or byte pressure. At the connection-key
cap, new connection buckets are refused without modifying existing buckets.
The already-existing verified connection record receives one boolean warning
flag, so no 129th notice-map key or recipient data is retained. Only that exact
connection sees the metadata-free overflow warning. It has no UUID and can
reappear after local dismissal until the connection ends; configuration updates
preserve it, while sign-out, connection expiry, or full reset clears it. Every
notice bucket expires within 12 hours. This queue is deliberately not durable
across process restarts or independent replicas.

The idempotency ledger is also process-local. A restart signs out the member,
and independent replicas must not be used as interchangeable send targets
without a shared encrypted session and atomic idempotency implementation.

## Provider draft boundary

`MailGateway` exposes runtime draft capability plus create/get/update/discard
operations over provider-independent `DraftContent`. The ordinary workspace
message page remains the list contract, so a provider draft appears in the
normal Drafts mailbox while its opaque provider ID becomes editable only after
the dedicated authenticated detail route proves `$draft` and Drafts membership.
The Standard IMAP/SMTP adapter reports `unsupported`; Stalwart JMAP reports
`supported`, `read-only`, or transient `unavailable` from its live session and
mailbox state.

The browser owns one stable compose UUID, distinct from the provider's immutable
Email ID. Stalwart stores the UUID and canonical-content fingerprint as bounded
non-system JMAP keywords, not RFC headers. These are provider-stored advisory
metadata, not a private JMAP extension. Create is idempotently reconciled by the
UUID and exact content. An update first creates and verifies one replacement,
then destroys the old Email in a separate conditional `Email/set`; JMAP `/set`
per-object results are never treated as transactionally atomic. Its operation
marker binds the account, old ID and revision, compose/content intent, sender,
and raw Message-ID/In-Reply-To/References values. The browser's revision is a
draft-specific digest of account and immutable Email IDs, so unrelated incoming
mail cannot create a false stale edit. Issued create, update, and discard
requests reconcile their exact provider outcome before Veda reports success.

Replacement construction occurs after the final freshness read. It preserves
enabled non-Veda keywords, additional mailbox membership, and the existing
`$seen` value; it forces Drafts and `$draft`, replaces only Veda reconciliation
markers, authenticates the From address, and preserves its validated display
name. Before old-draft cleanup, the server reloads and compares mutable
metadata; a concurrent external edit conflicts rather than being discarded.

Imported content is editable only when the provider returns a complete ordered
header inventory, equivalent ungrouped address projections, and a bounded
canonical plain-text, plain/HTML, or mixed attachment MIME structure. Duplicate or unknown
behavior-bearing headers, named address groups, malformed reply metadata,
unsupported MIME parameters/part metadata, excessive nesting, missing or
truncated body values, and attachment inventories above 10 files or 18 MiB all
fail closed as non-editable. Provider HTML still crosses the existing sanitized
presentation and outgoing canonicalization boundaries, so unsupported content
is never partially rewritten. New attachments enter only through the encrypted,
scanned quarantine; retained attachments are exact draft-scoped opaque IDs.

Sending a provider draft is manual-save-first. Identity and mailbox preflights
complete before a final reload validates the exact draft ID, revision, compose
marker, visible content, sender identity, body completeness, and ordered
attachment inventory. Veda first conditionally claims that old Email so concurrent clients
cannot both send it. Account-global compose-marker membership is then required
to contain exactly that claimed Email, including after every reconciliation or
retry. One JMAP batch creates a fresh send copy and submits it through the RFC
creation reference `#createId`; submission therefore cannot run if creation
failed. Acceptance requires the exact submission result. Its implicit
Drafts-to-Sent update is trusted only with a continuous Email-state chain from
creation; otherwise the exact created copy is independently verified and
repaired best-effort without downgrading authoritative submission evidence.
The claimed old draft is then removed best-effort. A definitive
rejection removes the unsent copy and releases the claim. Any issued ambiguous,
partial, contradictory, or cleanup-uncertain result leaves the old draft
claimed and read-only, tells the member to check Sent, and is never submitted
again automatically; the member may explicitly discard that exact revision
after checking.

## Composer recovery boundary

Every authenticated provider receives browser-local interrupted-compose
recovery, independently of provider draft capability. A journal is bound to the
exact provider ID, account ID, opaque member-session scope, and server-issued
session expiry. Raw recipients and message bodies live only in a strictly
validated IndexedDB record keyed by session scope and compose UUID;
`sessionStorage` contains only opaque record pointers. An indexed scope lookup
can rediscover a valid pointerless record after its original tab closes.

Each record is capped at 3 MiB, uses compare-and-swap storage revisions, and is
protected by record and scope tombstones so a stale tab cannot recreate purged
content. Expired records are removed in bounded indexed batches, tombstones are
retained for seven days, and no more than the four newest valid records for the
session are retained. Unsaved attachment bytes and upload capabilities remain
tab-only and are never copied into the journal; provider-saved attachment
metadata is restored from the authoritative draft. A durable send terminal stores only a
canonical SHA-256 request fingerprint plus any provider-draft revision binding;
the send request remains in memory. Sign-out, server-issued expiry, and session
invalidation revoke only the exact scope. The revocation is broadcast
to matching same-origin tabs so each immediately removes cached mailbox DOM;
newer or unrelated scopes ignore it. After server sign-out succeeds, local
cleanup failure keeps every notified tab curtained and retry never repeats the
server DELETE. Sign-out confirmation is deliberately session-wide because an
exact-scope purge also removes recovery created by another open tab.

When provider drafts are supported, autosave starts after two idle seconds and
no later than fifteen seconds after the first unsaved change. It permits one
request in flight and one newest trailing save, pauses offline, reconciles an
exact lost response, and retries at 2/4/8/16/30 seconds. The local journal
remains the recovery layer for providers without writable draft support.

Send and permanent-discard operations write an exact terminal intent before
issuing HTTP. An ambiguous send outcome exposes only **Check Sent** and cannot
be submitted or discarded again automatically. Confirming that Sent was
checked atomically converts the terminal record back to an ordinary recovery
record. An interrupted discard can replay only its exact provider draft ID and
revision. Closing a normal composer first removes its ordinary recovery copy;
unresolved terminal evidence is preserved.

## Email signature boundary

Email signatures are durable Veda Mail preferences, not provider-side identity
objects. The member route first authenticates the current provider connection,
resolves its account through `MailGateway`, and derives the owner from that
gateway-owned email address plus the connection's provider ID. The browser
cannot supply or override an owner address.

The initial workspace response also carries a non-authenticating, one-way scope
for the exact in-memory connection. Every later account-derived request echoes
that scope: workspace refreshes, message reads and mutations, delivery notices,
signature reads and writes, profile/password/2FA settings, sign-out, message
submission, and attachment capability, upload, import, preview, inline-image,
download, and archive operations. The server compares it with the current
HttpOnly-cookie connection before reading account state or contacting a
provider. A stale tab therefore fails with HTTP 409 if another tab replaces the
shared member session. When the workspace or message model observes that 409,
or an authenticated 401, it clears the workspace, reader, mailbox, search, and
pending request state and latches that mounted mail model as invalid. Effects
and manual refreshes cannot bootstrap an unscoped replacement account; only a
full page reload creates a fresh model that may bootstrap without a scope.
Settings and security hooks reset at layout time and ignore completions from
their previous scope. Attachment capability state follows the same rule: a
scope change invalidates the request generation and prevents a late response
for the former account from committing. The server-rendered upload limit is
paired with the exact server-derived initial scope and is reused only when the
client workspace accepts that same scope. Otherwise the limit clears until a
scoped capability refresh succeeds.

Normal scoped requests use the `X-Veda-Mail-Session-Scope` header. Native ZIP
downloads cannot attach a custom header, so an authenticated, scoped `POST`
preflight exchanges it for a random 256-bit archive ticket. Only the ticket is
placed in the native GET query; the session scope never enters a URL. Tickets
expire after 30 seconds, are stored only as SHA-256 digests, bind the exact
connection and message, and are deleted before binding validation so every
presentation is single-use. Archive responses remain private, non-cacheable,
same-origin, and `no-referrer`; the current member cookie is still required.

## Mailbox cursor pagination

The workspace route owns the page size (50). It exposes only an opaque,
HMAC-SHA-256-authenticated cursor with a 30-minute lifetime, never a raw adapter
position. The signed payload binds the provider cursor to the connection,
mailbox, keyed search digest, newest/oldest order, preview mode, page size, and
format version. The route rejects an oversized, malformed, expired, or
context-mismatched cursor with HTTP 409 `MESSAGE_LIST_CURSOR_EXPIRED`; the
client must refresh page one instead of changing or incrementing a cursor.

The current JMAP and IMAP adapters still paginate internally by bounded
positions. JMAP orders `receivedAt` ascending or descending. IMAP orders UIDs
ascending or descending, which represents mailbox arrival/order semantics and
is not guaranteed to match the sender-controlled `Date` header. The opaque
route cursor preserves this provider-specific meaning without exposing or
trusting it at the browser boundary.

The mail model separates root mailbox/search refresh generations from page
request generations. It permits one page request in flight, ignores a late
page after any root refresh, mailbox/search change, or session replacement,
and appends only previously unseen immutable message IDs. The selected reader
record is stored independently of the accumulated list, so adding a page does
not close or replace the message being read. A recoverable provider failure
leaves the accepted pages intact and reuses the same server cursor only after
an explicit retry. Full refresh replaces the accumulated list with page one.

## Message-list preferences and previews

The authenticated account owns exactly one message-list preference record:
`compact`, `comfortable`, or `spacious` density; `newest` or `oldest` order;
and whether a summary preview is requested. The browser cannot select another
owner. The strict same-origin, session-scoped PATCH route accepts only those
three fields at `PATCH /api/v1/mail/preferences`, with a 1 KiB body and separate
request/subject rate limits.

`/data/message-list-preferences.json` stores an HMAC-derived account index and
AES-256-GCM-encrypted preference value. Its key is derived from the installation
session secret with HKDF, and the owner index is authenticated as additional
data. Writes use a mode-0600 temporary file, fsync, and atomic rename inside a
mode-0700 data directory. The bounded store accepts at most 10,000 owners and a
16 MiB file; missing or unreadable account state falls back to comfortable,
newest, preview-on defaults. The writer is process-serialized, so a writable
data volume remains single-replica.

The workspace response carries the effective server preference. A later list
query may echo sort and preview context, but the route returns HTTP 409
`MESSAGE_LIST_PREFERENCES_CHANGED` if either differs from persisted state. A
sort/preview save refreshes page one and invalidates old cursors; a density-only
change is presentation-local and need not call the provider.

Stalwart JMAP requests its `preview` property only when previews are enabled.
Before reaching the browser, a preview has control and bidirectional formatting
characters removed, whitespace collapsed, and is capped at 320 characters and
1,024 UTF-8 bytes. Standard IMAP list summaries intentionally request no
source/body bytes and therefore expose an empty preview in this release. This
message-list snippet is separate from the explicit, scanned attachment-preview
flow.

## Bounded bulk mailbox mutations

The message-list selection is a separate set of opaque message IDs. A member
may select individual rows or every currently loaded row; Veda Mail never
claims that this selects unseen provider results. Draft rows remain routed to
the provider-draft editor and cannot enter ordinary message bulk operations.
Mailbox, search, session, and root-workspace generations clear or invalidate
selection. A completion is accepted only if its member scope and root view
revision still match the request that started it.

`PATCH /api/v1/mail/messages/bulk` accepts one strict 64 KiB JSON operation
with 1–100 unique IDs. Same-origin, member-session-scope, global request, and
verified-connection rate limits run before provider resolution. The server
runs at most four ordinary provider-port mutations concurrently and returns
only succeeded and failed IDs; provider exception text is not serialized. The
client permits one batch in flight, removes succeeded IDs from selection,
retains failed IDs for an explicit retry, refreshes authoritative page one,
and announces the result without replacing an independently open reader.

Read/unread, star/unstar, archive, spam, trash, restore, and move use the same
provider-independent mutation contract as single-message actions. Permanent
delete maps to JMAP `Email/set/destroy` or IMAP UID EXPUNGE after scoped
identity and `UIDVALIDITY` revalidation. The request includes its source
mailbox; the server verifies that mailbox has the Spam/Trash role and reloads
each message to confirm current membership before destruction. JMAP then
rechecks the minimal mailbox membership and supplies its collection state as
`ifInState`, so an intervening account mutation fails instead of destroying
against a stale check. It is guarded by an inert-background, focus-managed
alert dialog. Cancellation performs no
provider request; confirmation is irreversible.

`POST /api/v1/mail/mailboxes/empty` is a separate strict 8 KiB, same-origin,
session-scoped operation for Spam and Trash only. The first confirmed call is
prepare-only: it durably stores a provider snapshot cursor in the encrypted
owner catalog before any deletion. Later calls claim one expiring single-writer
lease and remove at most 100 provider targets. Only prepared operations are
exposed for automatic resume, and a preparation failure or process loss requires
fresh confirmation rather than silently widening the snapshot.

The JMAP adapter binds the cursor to account, mailbox, cutoff, and query state.
It checks `Email/queryChanges` before and after every state-conditioned destroy;
any post-confirmation addition or unbounded change history expires the snapshot.
The IMAP adapter binds the cursor to the canonical mailbox, `UIDVALIDITY`,
optional OBJECTID, and the confirmation-time `UIDNEXT - 1`. It walks bounded
4,096-UID windows, requires UIDPLUS exact expunge, and never issues plain
EXPUNGE. Provider cursors are HMAC-authenticated with an installation-derived,
owner-scoped key and never enter the browser or workspace response.

## Custom mailbox administration

`POST`, `PATCH`, and `DELETE /api/v1/mail/mailboxes` accept strict 16 KiB JSON
operations after same-origin, member-session-scope, global request, and
verified-connection rate limits. Mailbox names are trimmed, single-line,
limited to 255 UTF-8 bytes, and checked case-insensitively after NFKC
normalization within one parent. The provider-independent policy caps custom
mailboxes at 256 and hierarchy depth at eight, rejects cycles and stale IDs,
honors provider rights, protects every system-role mailbox, and permits delete
only when the target is custom, empty, childless, and provider-authorized.

JMAP maps `parentId`, `sortOrder`, and `myRights` into the domain model. Every
mutation starts with `Mailbox/get`, validates that authoritative snapshot, and
sends `Mailbox/set` with `ifInState`. Delete always sets
`onDestroyRemoveEmails: false`; `mailboxHasEmail`, `mailboxHasChild`, rights,
and state conflicts become safe domain failures. IMAP derives parent IDs from
LIST `parentPath`, rejects the active server delimiter inside a leaf name,
uses CREATE/RENAME/DELETE through ImapFlow, and reloads LIST after success.
Immediately before DELETE it issues STATUS and aborts if any message exists.
IMAP cannot make that final check and DELETE atomic, so a remote delivery in
that narrow interval remains a documented provider limitation.

Mailbox color is presentation metadata rather than a JMAP or IMAP standard.
The fixed `/data/mailbox-appearance.json` sidecar stores no raw email address,
mailbox ID, or color outside authenticated ciphertext. HMAC-SHA-256 keys select
normalized provider/email owner buckets; AES-256-GCM with an HKDF-derived key
and owner-bound additional data encrypts each strict book. Writes use a
mode-0600 temporary file and atomic replacement. IMAP rename migrates the
appearance from the old opaque path ID to the new one. If a provider mutation
succeeds but the optional appearance write fails, the API reports that state
without misrepresenting the already-committed provider operation as failed.

## Portable labels

Veda labels use an opaque stable `veda-label-` keyword derived from 128 random
bits. Display names and colors never enter provider state: they live in the
account-scoped encrypted `/data/mail-label-catalog.json` catalog. Names are
NFKC-normalized, single-line, unique after case folding, and limited to 100
characters and 255 UTF-8 bytes; each account is capped at 256 labels. Browser
APIs accept only catalog IDs, enforce the current mail-session scope, and
resolve an active owner-bound catalog record before any provider mutation.

JMAP maps a label to an Email keyword. Before changing it, the adapter reloads
authoritative keywords, mailbox membership, Email state, every containing
mailbox's `maySetKeywords` right, and the advertised `maxKeywordsPerEmail`.
`Email/set` changes only the selected keyword with `ifInState`, confirms the
account and updated message, and performs one bounded authoritative retry after
`stateMismatch`. IMAP maps the same ID to a user flag. Additions require absent
`PERMANENTFLAGS`, `\\*`, or an already-permanent token; removals remain allowed.
The adapter uses UID STORE and then refetches flags because servers may silently
discard unsupported keywords. Copies in ordinary IMAP mailboxes may have
independent flags and are not presented as JMAP-style account-global objects.

The sidebar provides accessible create/rename/recolor controls; selected rows
and the reader provide apply/remove controls. Unknown provider keywords never
become catalog labels. Deletion first marks the encrypted catalog record as
`deleting`, which immediately rejects new applications and edits. A one-minute
lease protects each bounded provider cleanup batch; its opaque provider cursor,
counts, and timestamps are durably recorded after the provider confirms the
batch. Provider cursors are HMAC-authenticated and bound to the provider,
account, label, and current credential; a credential rotation safely restarts
the idempotent sweep. An owner/label operation queue serializes in-flight label
applications against cleanup on the supported single-writer deployment.
Workspace loads expose only bounded progress metadata and automatically resume
interrupted work. Finalization requires two separate empty provider
checks, removes the catalog record, and retains a non-reusable tombstone. The
message itself and its mailbox membership are never deleted.

With the supplied Compose layout, signature books live in
`/data/member-signatures.json`. The outer file contains keyed owner buckets but
no raw email addresses or signature plaintext. An HMAC-SHA-256 of the
normalized provider/email identity and installation session secret selects the
bucket. Owner-key v2 lowercases the provider ID and email domain but preserves
the email local-part. Reads accept only this v2 key. Case-collapsed pre-release
v1 buckets are ignored and are never automatically adopted, migrated, or
deleted, preventing ambiguous data from crossing case-distinct identities.
Each book is independently encrypted with AES-256-GCM under an HKDF-derived key;
authenticated additional data binds its ciphertext to that owner key. Strict
schemas are applied outside and after decryption. Invalid, noncanonical,
corrupted, or authentication-failing records fail closed.

Writes create a mode-0600 temporary file, sync it, and atomically replace the
fixed store. A member may keep at most 20 case-insensitively named signatures.
Each successful create, update, delete, or default change rotates an opaque
book revision. A mutation supplies the revision it read; a stale revision
returns a conflict instead of silently replacing another browser's change.
Deleting a signature also clears either default that referenced it.

The settings model does not treat an absent book as an empty authoritative
book. Mutation and default controls stay disabled until loading succeeds, and
the save handler independently refuses a missing book. Rich Lexical editors
publish one explicit layout-time initialization snapshot to establish the
canonical baseline; normal change events are always edits, so the first user
keystroke cannot be mistaken for editor initialization.

Signature writes require same-origin validation before authentication, a
bounded 128 KiB JSON body, strict discriminated operation schemas, and
request/verified-connection rate limits. Names are single-line and capped at
80 characters and 256 UTF-8 bytes. Plain or rich source fields are capped at
16 KiB characters and bytes. The canonical plain/HTML pair is capped at
32 KiB combined, with rich input limited to 256 elements and nesting depth 16.
Rich content passes the centralized outbound sanitizer, which removes active
content, remote media, arbitrary styles, and unsafe links and derives the
plain variant from the sanitized HTML.

The composer inserts only that canonical pair. The ordinary send boundary
canonicalizes the complete message again before either provider receives it,
so signatures do not add a provider-specific MIME or API shape. No Stalwart
configuration, schema, migration, or additional endpoint is required.

Revision compare-and-write serialization is process-local. Exactly one Veda
Mail process may write a given signature file. Multiple replicas sharing a
writable `/data` volume can race and are unsupported until this file store is
replaced by a shared transactional implementation.

## Reusable email template boundary

Reusable templates are Veda-local per-provider/mailbox metadata, not JMAP or
IMAP objects. `/api/v1/member/templates` derives the owner from the verified
current gateway account after the exact browser mailbox scope check. The API
accepts only strict create, update, or delete operations with the revision the
browser read; ownership, recipients, attachments, reply metadata, draft IDs,
provider identifiers, and send authority are never request fields.

Each owner book lives in `/data/member-templates.json`. Its HMAC owner index and
HKDF/AES-256-GCM encryption use template-specific versioned contexts, so neither
keys nor ciphertext can be substituted with signature data. The outer store is
bounded to 10,000 owner buckets and 64 MiB; each owner is limited to 50 uniquely
named templates and 4 MiB of canonical content. Writes use the same mode-0600,
fsync, atomic-replacement and exact-revision discipline as other encrypted
member metadata, with a separate process-local writer queue.

Rich content passes the centralized outgoing allowlist before encryption and is
revalidated after decryption. The composer exposes two distinct use-time
operations: Insert changes only body content at the current selection, while
Replace changes only subject and non-signature body after confirmation when
content exists. Both preserve recipients, CC/BCC, attachments, reply context,
provider draft identity, and the exact managed Lexical signature slot. Template
creation removes that managed signature from the stored rich snapshot. The
complete result crosses the normal draft/send canonicalization boundary again;
no Stalwart setting, provider extension, mailbox migration, or new port exists.

## Contacts and recipient-history boundary

Contacts are Veda-local metadata, not provider address-book objects.
`GET`/`PUT /api/v1/member/contacts` and
`GET`/`POST /api/v1/member/contacts/vcard` require the current HttpOnly member
session and its exact browser mailbox scope; writes additionally require the
same origin. The server resolves the authenticated gateway account and combines
its canonical email with the provider ID. Neither API accepts an owner identity,
provider credential, or mailbox locator from the browser.

`/data/member-contacts.json` contains an HMAC-SHA-256 owner index and one
independently encrypted owner book per identity. The encryption key is derived
from the installation session secret with a contact-specific HKDF-SHA-256
context. AES-256-GCM authenticates both ciphertext and versioned owner-key AAD,
so a bucket cannot be substituted between providers, identities, installations,
or another metadata format. The outer file is capped at 64 MiB and 10,000
owners; a decrypted book is capped at 8 MiB, 2,000 contacts, 200 groups, 500
recent recipients, five emails per contact, and 500 members per group. Strict
schema validation follows authenticated decryption. Writes require the exact
revision read by the client and use a process-serialized mode-0600 temporary
file, fsync, and atomic rename.

Contact and group create/update/delete operations are preflighted as one book
revision. Email addresses are unique across contacts, group names and members
are unique, groups reference only existing contacts, and deleting a contact
removes its memberships and any resulting empty group. The composer derives at
most eight suggestions from contacts, first-address group expansion, and
non-duplicate recent recipients, matches only the active To/CC/BCC token, and
preserves earlier recipient tokens. Prefix matches precede substring matches;
the bounded history itself retains newest use, frequency, and canonical-address
ordering. No provider-specific address-book API enters this path.

Recent history is appended only after provider delivery evidence. Accepted
delivery records each unique To/CC/BCC address; partial delivery omits every
canonically rejected address; an uncertain outcome records nothing. Scheduled
delivery follows the same rule. Contact-store failure is logged and cannot turn
provider-confirmed delivery into a retry or duplicate send. Stored history has
only address, optional display name, last-used time, and use count; it does not
retain whether an address came from To, CC, or BCC.

vCard import accepts bounded UTF-8 vCard 3.0 or 4.0 text, unfolds CRLF/LF lines,
and maps `FN`, `N`, `EMAIL`, `ORG`, `CATEGORIES`, and `UID`; categories become
groups in the same optimistic import revision. It rejects invalid controls,
escapes, encoded/URI email values, over-limit cards/properties/lines/values, and
cards with more than the domain's five-email limit. `PHOTO`, `LOGO`, `KEY`,
`AGENT`, and `URL` are inert and ignored without decoding or network access.
Export emits deterministic vCard 4.0 with escaped values and UTF-8-safe 75-octet
CRLF folding through a private, no-store, `nosniff` attachment response.

## Calendar invitation and local event boundary

`MailGateway.listCalendarParts` and `downloadCalendarPart` are the only provider
calendar primitives. JMAP walks bounded `Email.bodyStructure` and binds an
opaque ID to account, message, ordinal, part, blob, name, and size before using
the hardened same-origin blob transport. IMAP walks bounded BODYSTRUCTURE and
binds account, message, UIDVALIDITY, exact section, transfer encoding, and name;
download reopens read-only, rechecks UIDVALIDITY, and streams only that decoded
section. Neither adapter treats a remote URL as content.

`GET /api/v1/mail/messages/:messageId/calendar` resolves the active connection,
loads account/message/part metadata, caps the part count at eight, re-fetches
each part at 1 MiB, and passes it through the existing ClamAV clean spool before
the strict RFC 5545 parser. The response contains only bounded canonical event
data, an inert canonical `.ics` representation, whether RSVP is allowed, and a
sender/organizer comparison. Malformed calendar parts are counted rather than
rendered; scanner/provider failures fail the request.

`POST .../calendar/respond` additionally requires same origin, an exact browser
mail-session scope, a strict 8 KiB JSON body, request/connection rate limits,
and a UUID idempotency key. It authoritatively re-fetches, scans, and parses the
part; obtains the attendee email from `MailGateway.getAccount`; and serializes a
one-attendee `METHOD:REPLY` addressed only to ORGANIZER. The internal outgoing
attachment marker is not part of the generic compose schema. SMTP maps it to
MailComposer's iCalendar event and JMAP maps it to an inline uploaded calendar
part with an explicit method parameter. Normal attachments cannot acquire that
marker through browser input.

Local import/export is deliberately not CalDAV. `GET`/`PUT
/api/v1/member/calendar` and `GET /api/v1/member/calendar/ics` derive ownership
from provider ID plus gateway-owned account address. The encrypted
`/data/member-calendar-events.json` store uses distinct HMAC/HKDF contexts,
AES-256-GCM owner AAD, strict canonical records, optimistic revisions, sequence
non-downgrade, a 1,000-event cap, mode-0600 atomic writes, and deterministic
whole-book RFC 5545 export. One import request mutates exactly one parsed event.

## Durable scheduled-send boundary

`POST /api/v1/mail/scheduled` accepts only an exact-revision provider-backed
draft after the standard mailbox-scope, origin, recipient, header, rich-content,
and draft-integrity checks. The browser cannot submit a provider configuration,
credential, owner identity, attachment byte, or arbitrary job state. JMAP and
IMAP/SMTP therefore share one queue contract while retaining their reviewed
saved-draft send paths.

The queue persists `/data/scheduled-jobs.json` with mode 0600, fsync, and atomic
replacement. Each owner book contains the canonical send request, provider
connection, absolute UTC time, bounded retry state, and lease, all inside an
AES-256-GCM envelope. Owner indexing and encryption use distinct HKDF contexts
from the external `VEDA_MAIL_JOB_KEY`; a keyed file verifier detects an incorrect
restore key. No scheduled content or provider secret appears outside ciphertext.

The Node instrumentation worker scans at a bounded interval and durably changes
one due job to `sending` before provider I/O. Accepted delivery removes it;
definite or exhausted failure remains visible; transient failure uses bounded
backoff; ambiguous delivery and interrupted leases become review-only
`uncertain`. This at-most-once recovery rule avoids duplicate SMTP delivery when
portable exact-once proof is impossible. The encrypted credential exception is
limited to explicitly scheduled jobs and deleted with the job. One application
replica remains the supported boundary.

Undo Send reuses this queue with a distinct `undo` purpose and a server-bounded
short deadline. The composer first saves the exact provider draft, receives the
created opaque job ID, closes only after durable admission, and shows a global
countdown. Undo performs the existing owner-scoped atomic cancellation before
reopening that exact provider draft. Once the worker commits a `sending` lease,
cancellation fails with a conflict and the UI truthfully reports that it is too
late. A disabled delay preserves the existing immediate submission path.

## Durable snooze boundary

Snooze persists a provider-specific, read-only-preflight plan before it creates
the owned Snoozed mailbox or moves a message. `/data/snooze-jobs.json` uses
Snooze-specific HMAC/HKDF contexts beneath `VEDA_MAIL_JOB_KEY`, owner-bound
AES-256-GCM, strict 100-job/10,000-owner/64-MiB limits, mode-0600 fsynced atomic
writes, and a keyed restore check. The owner HMAC includes a stable
provider-account scope, preventing the same username on different hosts from
sharing a book. Credentials and provider locators never appear in the
authenticated projection.

The worker commits a random lease before provider I/O. Every hide and wake first
inspects the stable JMAP identity or IMAP UIDPLUS/OBJECTID/unique-keyword plan.
Interrupted work becomes `retry-hide` or `retry-wake`, never delivery-style
`uncertain`. Manual restoration and deletion complete safely; authentication or
terminal failure clears the connection, while authenticated retry supplies the
current connection. Owned-mailbox metadata remains after the last job. The file
store and lease coordinator support one application process per `/data` volume;
multi-replica deployment requires a shared transactional store.

## Provider-native mail-rules boundary

`MailGateway.getRuleCapability`, `deployRules`, and `previewRules` form the
provider-independent Rules contract. The domain owns the canonical ordered rule
book, strict condition/action types, evaluator, and provider DTOs. Infrastructure
adapters own capability discovery, message-fact projection, Sieve transport,
and provider concurrency semantics. Presentation code never supplies a script,
credential, provider state, owner, or raw provider identifier.

The shared compiler emits deterministic CRLF Sieve with injection-safe quoted
strings and only the required advertised extensions. Stalwart maps deployment
to RFC 9661 `SieveScript/get`, blob upload, `SieveScript/validate`, and a state-
conditional `SieveScript/set` activation. Standard IMAP maps the same contract
to a separately configured TLS-protected RFC 5804 ManageSieve session. Provider
capability discovery is authoritative; missing ManageSieve leaves Rules visibly
unsupported rather than falling back to browser or server polling.

The ManageSieve transport treats connection establishment as one fail-closed
transaction. Direct TLS must complete certificate and hostname verification
before the greeting is read. STARTTLS must receive an accepted plaintext
greeting and upgrade response, then complete verified TLS and a fresh
CAPABILITY exchange. Any failure destroys both the current wrapper and its
underlying setup socket. Bounded fragmented response parsing retains the
original timeout or socket failure for diagnosis without exposing credentials.

`/data/member-rules.json` stores the desired rule book, deployment revision,
provider state/hash/script ID, and bounded audit under an owner-isolated
AES-256-GCM envelope. A deployment first commits an encrypted intent containing
the current provider connection, performs provider I/O, then CAS-finalizes and
erases the connection for every result. This is not a durable worker queue. A
subsequent retry requires a current authenticated mailbox session and reconciles
an exact already-active owned script before issuing another mutation.

Script ownership is separate from script naming. The compiler prepends an
installation-key HMAC bound to the exact generated body; the adapter must
download and verify it before update. A same-name foreign script or any foreign
active script is a visible conflict and remains unchanged. This protects
vacation and scripts installed by another client or Veda Mail installation.

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

The route fetches through `MailGateway` under a 50 MiB decoded-byte ceiling and
bounded concurrent-download budget. Known- and unknown-length streams are
consumed exactly once into a request-scoped AES-256-GCM spool with random
mode-0600 filenames in a mode-0700 process directory. The spool hashes the
plaintext while the same complete stream feeds the bounded ClamAV scheduler.
Only a complete clean verdict creates a scope-bound, single-use serving handle;
the browser never receives a provider re-fetch or a byte that was not scanned.
Every successful response is forced to
`application/octet-stream` plus an attachment-only, sanitized
`Content-Disposition`. It is private and non-cacheable and carries `nosniff`,
a sandbox CSP, and same-origin resource policy. Byte-range requests are
rejected because partial-response semantics are not implemented.

The JMAP adapter resolves the authenticated account download URL, requires
identity transfer encoding, and checks the streamed byte count against
authoritative metadata or a valid provider `Content-Length` when either is
known. A chunked response is accepted only under the same streaming byte
ceiling. The IMAP adapter opens the source mailbox read-only,
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
only the opaque message ID plus the single-use ticket issued by its immediately
preceding scoped preflight; neither a session scope nor provider identifier is
placed in the URL. A signal-aware gateway call authoritatively
classifies the current visible/downloadable attachments and may inspect bounded
message presentation data to apply the same sanitizer and inline-image render
cap as the reader. The existing per-attachment gateway operation then
revalidates and opens each source sequentially.

Before creating a response, the server sequentially stages and scans every
original entry into the same encrypted received-attachment quarantine. A later
infected, unavailable, oversized, truncated, or corrupt entry therefore blocks
the operation before any local ZIP header or payload byte exists. The server
then writes the verified copies into a classic ZIP stream in STORE mode with CRC-32 data
descriptors, fixed privacy-safe metadata, regular-file attributes, and one
flat, sanitized, collision-safe UTF-8 name per attachment. It never buffers a
complete archive, creates a plaintext temporary file, follows a provider path,
or expands a nested archive. The boundary allows at most 100 entries, 50 MiB
per entry, and 200 MiB of actual decoded payload under a ten-minute deadline,
four global archive leases, one lease per member, and the shared download
budget. Any cancellation, dishonest length, no-progress stream, or provider
failure stops later fetches and omits the central directory, leaving no
success-looking partial ZIP.

All upload, import, preview, inline-image, direct-download, and archive scans
share a process-global four-active/32-waiter FIFO scheduler. Queue wait,
connection, socket-idle, whole-scan, and verdict deadlines fail closed and
release permits on every terminal path. The Compose-managed `clamd.conf` also
caps a 50 MiB input, 100 MiB expanded scan, eight recursion levels, 1,000
contained files, scan time, parser limits, threads and queue depth. Encrypted
content or any ClamAV limit breach produces a blocked verdict.

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

The client creates import jobs only for attachments that the current reader
classifies as final visible file cards. This is a usability filter, not an
authorization decision: before downloading, the server independently re-lists
the authoritative message presentation and requires the opaque ID to have
`attachment` disposition. Rendered, hidden, stale, or forged inline IDs cannot
cross into the outbound quarantine.

Decoded bytes are collected once into a fixed-size bounded buffer so IMAP's
unknown decoded length can be measured without a second provider fetch. The
buffer is exposed to quarantine in fixed 64 KiB views, then wiped. Only after
the exact byte count is known does the server reserve draft quota, sanitize the
provider-bound name and MIME hint, run ClamAV plus magic-number detection,
encrypt the clean result, and return a normal quarantine upload ID. Abort,
timeout, provider, quota, type, scan, or storage failure cancels the source,
removes the reservation, and releases every resource lease. A later send uses
the same claim, integrity-check, retry, and consume path as a local upload.

## Message move boundary

List drag/drop and the list/reader keyboard-touch dialogs converge on the same
bulk mutation coordinator. The coordinator deduplicates IDs, sends at most 100
per request, refreshes authoritative state, removes only succeeded IDs from
selection, and reports partial failures. Target labels use bounded mailbox
breadcrumbs; Drafts, Sent, the source mailbox, non-selectable destinations, and
mailboxes without `mayAddItems` are excluded.

Every request names an exact source and destination. The route reloads the
mailbox rights snapshot and each message's current membership before calling a
provider. JMAP changes only the two addressed membership keys under an
`ifInState` precondition with one bounded state-mismatch refresh. IMAP scopes
the message ID to the exact source mailbox and UIDVALIDITY, verifies the UID,
and requires native MOVE; it never emulates a move with COPY plus unscoped
EXPUNGE.

Native drag data contains only a random, short-lived token. Message IDs and
content remain in a session/view/source-bound in-memory intent that is cleared
on drop, cancel, navigation, or session change. External and stale drops cannot
invoke the mutation path.

## Keyboard command boundary

Mailbox-wide single-key commands are opt-in through the same encrypted,
account-isolated preference record as density and sending choices. Older
three-field and pre-shortcut five-field plaintext shapes are accepted only
inside the authenticated encrypted record, then projected in memory with
shortcuts off. The strict HTTP write contract requires the complete current
shape and rejects unknown or incorrectly typed fields.

The browser listener normalizes only unmodified, non-repeated keys. It rejects
events originating in an input, textarea, select, contenteditable descendant,
textbox, or combobox, and suspends every command while the composer or any
modal is open. Commands call the same capability-, rights-, session-, and
confirmation-aware view-model actions as visible controls; they are not an
alternate mutation API. Unavailable actions do nothing.

The shortcut guide is a focus-trapped modal reachable without enabling the
listener. Enabled visible controls expose `aria-keyshortcuts`, outcomes use a
polite live region, opening a message moves focus to its subject after loading,
and closing returns focus to the exact message trigger or the mailbox heading.
A first-focus skip link bypasses global navigation without requiring shortcuts.

## Conversation boundary

The provider-independent `MailGateway.getConversation` contract accepts an
authenticated, opaque anchor message ID plus a server-owned snapshot-bound
provider cursor. The HTTP layer fixes the page size at 25, applies a dedicated
30-per-account/minute conversation limit,
and replaces the provider cursor with a 30-minute HMAC cursor bound to the
connection and anchor. No protocol thread/header identifier crosses the public
trust boundary.

The JMAP adapter first resolves the anchor using exact `Email/get`, then uses
its provider-owned `threadId` in `Thread/get` and fetches only the returned
exact Email IDs. It validates account IDs, response partitions, anchor
membership, and exact result membership before mapping a message.

The IMAP adapter keeps the anchor's scoped mailbox, UID, and UIDVALIDITY
authoritative. OBJECTID/X-GM-EXT-1 supplies an exact native thread path where
available. Otherwise a bounded graph follows RFC Message-ID, In-Reply-To, and
References fields across at most 32 readable mailboxes. Header SEARCH results
are untrusted candidates because servers may perform substring matching; each
candidate is fetched and exact identifier intersection is rechecked before it
can expand the graph. Selected reply headers use a 65,537-byte partial fetch;
anything beyond the 64-KiB accepted boundary is discarded and marks the result
truncated. The graph allows no more than 64 identifiers, four
search batches, and 100 verified messages. It never uses subject equality.

Both paths de-duplicate exact provider message identities, order ascending by
received time with opaque ID as the tie-break, and expose an explicit truncated
flag at the 100-message safety boundary. Later-page cursors bind a hash of the
exact ordered set and fail closed if provider changes would shift the offset.
Selecting another loaded member keeps the original anchor and accumulated
conversation page, but replaces the authoritative reader detail. Reply, Reply
All, Forward, mailbox rights, attachment actions, details, and the visible
action group therefore resolve from that selected detail rather than the
conversation anchor.

Per-message details are a presentation projection of normalized domain fields:
address lists, received date, RFC message size, visible attachment count/known
size, and loaded conversation position. Raw headers and provider message or
thread identifiers never enter the details view. The native `details` element
preserves keyboard and assistive-technology behavior without a second state
store.

Quoted-history collapsing is reversible and presentation-only. Plain text is
split at bounded reply/forward markers; ambiguous `On ... wrote:` prose remains
visible unless a quoted line follows. Sanitized HTML stays in the existing
sandboxed, CSP-locked iframe, where a body class hides only `blockquote`
elements. Toggling recreates the document revision so height and bounded inline
image state cannot cross revisions; the stored/provider source is never edited.

pages. Reader role, move source, and destructive permissions derive from that
member's actual mailbox. The ordinary scoped detail route preserves existing
mailbox and session authorization checks.

## Mail update boundary

Automatic mailbox refresh remains provider-independent and keeps provider
credentials server-side. A scoped `GET /api/v1/mail/updates` request enters one
connection-keyed single-flight wait. Stalwart validates the discovered JMAP
`eventSourceUrl` against the configured HTTPS origin, expands only Email and
Mailbox state events, closes after one state change, and accepts at most a
64 KiB schema-validated event. A quiet JMAP wait triggers an authoritative
reconciliation after 55 seconds, closing the subscription-start and reconnect
races. Standard IMAP/SMTP advertises a 60-second polling fallback instead of
holding an IDLE connection in an HTTP request.

The client runs only one update loop for the active session scope. It pauses
while the browser is offline and, by default, while the tab is hidden. An
explicit browser-notification opt-in keeps that same loop active while the tab
is hidden; no second provider subscription is created. IMAP refresh remains
delayed until the bounded poll interval, and transient transport failures use
capped exponential backoff. Session-scope failures stop the loop and enter the
existing account invalidation path. Provider URLs, account state tokens, and
credentials never enter a browser URL or response.

## New-mail notification boundary

An authoritative workspace refresh compares provider-independent Inbox totals
and, when Inbox is the active view, normalized message IDs. Initial loads,
account changes, and read-state-only changes cannot create a notification. The
visible application receives an accessible dismissible in-app notice. A hidden
tab can create a Web Notification only after a direct Enable action obtains the
browser's `granted` permission; rendering, opening settings, and ordinary mail
traffic never request permission.

Notification preferences are browser-local, schema-bounded, and isolated by a
length-delimited provider/account owner. The default is disabled with generic
count-only text. Sender and subject require a separate explicit choice. Message
preview/body content, provider credentials, and notification history are never
written to browser storage. This phase deliberately has no service worker or
Web Push subscription, so browser alerts require an open Veda Mail tab; closed-
browser delivery belongs to the separately capability-gated PWA milestone.

## Installable application and offline boundary

Production clients register one root-scoped service worker after the window
load event. The install manifest uses the installation's public product name
and colors, while its application icons are deterministic crops of the public
Veda Mail artwork. Development mode does not register a worker, which keeps
local fixture and hot-reload behavior outside the production cache lifecycle.

The worker owns one versioned, Veda-prefixed cache containing exactly four
public resources: the generic offline HTML and CSS plus 192 px and 512 px
icons. It has no runtime `cache.put` path. Same-origin navigations remain
network-first and fall back to the generic offline document only after a
network failure. Cross-origin requests, non-GET requests, APIs, authenticated
documents, mail, attachments, and application chunks are never intercepted or
cached. Activation deletes only stale Veda-prefixed offline caches, leaving
unrelated origin storage untouched. Worker HTTP responses are non-cacheable so
updates are always revalidated by the browser.

Offline mode is deliberately not an offline mailbox. The fallback contains no
account identity, message metadata, provider state, or executable script and
states that no messages or account details are stored offline. Reconnection
and stale-mailbox state remain a separate roadmap slice.

## Connectivity recovery boundary

Browser connectivity is treated as a presentation hint, never as proof that a
provider is reachable. An `offline` event immediately labels the already
authorized mailbox snapshot as potentially stale. An `online` event starts one
single-flight authoritative workspace refresh; repeated online events, refresh
clicks, and Retry actions join that same read instead of creating a request
storm. A successful read briefly announces restoration, while an online
transport failure retains the snapshot with an explicit stale warning and one
manual Retry control. Initial loads and mailbox/search changes still fail with
their ordinary scoped error instead of displaying a snapshot for a different
view.

The provider-independent update loop marks its snapshot stale after a transient
wait failure, keeps capped exponential backoff, and records a mandatory refresh
before it opens the next provider wait. Offline-to-online recovery therefore
does not wait for the next 55-second JMAP reconciliation or 60-second IMAP poll.
Only the idempotent workspace read is automatically repeated. Sends, draft
mutations, message moves, deletion, rules, and other writes retain their own
existing idempotency or explicit-retry boundaries and are never replayed by the
connectivity layer. Session-scope failures still invalidate the account and
activate the privacy curtain rather than exposing a stale authenticated view.

## Accessibility boundary

The presentation layer treats keyboard focus, semantic status, reflow, motion,
and contrast as release contracts rather than styling details. The primary
member flows must remain operable at a 320 CSS-pixel viewport, expose no axe
WCAG A/AA violations, retain a visible primary keyboard path, and reduce all
non-essential motion when the operating system requests it. Branding derives a
contrasting accent foreground instead of trusting an administrator-provided
color to carry readable text. Dialog connectors own initial focus, containment,
and return focus, while background application regions become inert.

Automated semantics cannot prove the quality of spoken output or arbitrary
sender-authored mail. The public accessibility guide therefore separates CI
evidence from the required deployed NVDA, VoiceOver, zoom, reduced-motion, and
forced-colors acceptance matrix. Sanitized sender HTML remains untrusted
content, and Veda Mail does not claim that external message authors supplied
accessible structure or alternatives.

## Localization boundary

Formatting locale and IANA time zone are encrypted, owner-isolated application
preferences rather than provider configuration. The server accepts only bounded
canonical locales and runtime-valid IANA zones. Selected wall-clock values for
Scheduled Send and Snooze are resolved to one UTC instant and reject nonexistent
daylight-saving times. Direction is derived from the locale, while document
language remains English until a translated source catalog exists; this avoids
giving assistive technology a false language signal.

## Observability boundary

The API proxy validates or creates a bounded request ID, forwards it through
the request, and echoes it on the response. Structured logging accepts only an
allowlisted operational schema and never serializes raw exceptions or provider
payloads. The gateway cache wraps each provider gateway once, so every provider
operation contributes process-local duration and success/error counters without
mailbox or connection labels. Interactive provider failures recover the current
request ID when available; workers use only stable event names.

`/api/health` is dependency-free liveness. `/api/ready` independently checks
the writable data boundary and the exact private ClamAV `PONG`, returning only
bounded check states. `/api/metrics` is disabled by default and requires a
constant-time compared server-side bearer token. Metrics are Prometheus text
with compiled provider/operation labels and reset with the process. The
[observability runbook](OBSERVABILITY.md) defines replica aggregation,
dashboards, retention, and alert thresholds.

## Security audit boundary

Protected routes produce strict metadata events through one server-only audit
contract. Mutations append an HMAC-authenticated attempt before the side effect
and settle it as success, failure, or partial. Actor and target indexes use
dedicated HKDF-derived HMAC keys; raw account, provider, rule, mailbox, message,
contact, and calendar identities never enter the record. Authentication events
use the same contract without storing credentials or source-network metadata.

The mode-0600 version-1 file is bounded to 10,000 entries, process-serialized,
fsynced, and atomically replaced. An entry-chain HMAC plus whole-file HMAC,
key-check, and monotonic sequence are verified before every append or read.
Retention advances the authenticated anchor and disclosed dropped count. The
administrator API returns only verified reverse pages and remains inside the
authenticated, rate-limited, private/no-store boundary. The store inherits the
single-writer runtime restriction and cannot detect restoration of an older
internally valid whole-file snapshot without an external checkpoint.

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

- Installation, branding, service profile, member 2FA, encrypted member
  signatures and reusable templates, and the secret-free mailbox-provisioning
  idempotency ledger are durable on `/data`.
- Pending attachment uploads are encrypted, process-local quarantine data with
  a 30-minute TTL; a one-minute background sweep expires them without another
  request, and production startup removes bounded orphan quarantine
  directories. They are not mailbox storage or backup content.
- Member connections and ordinary gateway credentials are memory-only for 12
  hours. Explicit scheduled jobs carry a bounded encrypted credential copy as
  described above.
- Restarting the process intentionally signs every member out.
- A multi-replica deployment needs a shared encrypted session repository and
  coordinated rate limiter, plus transactional replacements for the
  process-serialized signature, template, and scheduled-job files, behind the
  existing server boundary.

The browser never talks directly to a provider. Cookies are opaque, HttpOnly,
SameSite=Lax, and Secure in production. Stalwart provider origins use HTTPS,
a mandatory production hostname allowlist, DNS resolution checks, and
private-address rejection. The same policy is checked when configuration is
saved and before provider requests.

Original-message export follows the same provider boundary. JMAP resolves an
exact `Email/get` blob behind the server-side authenticated download template;
IMAP decodes the account-scoped opaque reference and pins mailbox UIDVALIDITY
plus UID before fetching source bytes. Both paths reject oversized, truncated,
stale, or mismatched results and expose only a fixed `message.eml` download to
the browser.
Rate-limit window keys contain keyed hashes of account, verified-session, or
trusted-source identifiers rather than their raw values.
