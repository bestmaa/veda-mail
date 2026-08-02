# Mail providers

Veda Mail separates the browser UI from the mail provider. One deployment has
one active provider profile and can allow many email domains served by that
profile.

## Included adapters

The capability values below describe features callable through Veda Mail
today, not every feature the upstream server protocol could eventually supply.

| Capability                                    | Stalwart JMAP   | Standard IMAP + SMTP |
| --------------------------------------------- | --------------- | -------------------- |
| Mailbox/message read                          | Yes             | Yes                  |
| Cursor-paginated message lists                | Yes             | Yes                  |
| Newest/oldest mailbox order                    | Yes             | Yes, UID order       |
| Optional message-list preview                  | Yes             | No body fetch        |
| Server-side text search                       | Yes             | Yes                  |
| Plain and safe rich-text send, To/CC/BCC      | Yes             | Yes                  |
| Per-identity email signatures                 | Yes             | Yes                  |
| Read/star/archive/move/trash                  | Yes             | Yes                  |
| Bounded bulk actions and permanent delete    | Yes             | Yes                  |
| Resumable Empty Spam/Trash snapshot           | Yes             | Yes, UIDPLUS required |
| Profile/password/provider 2FA management      | Yes             | No                   |
| Admin user list/detail/create                 | Yes, optional   | Unsupported          |
| Manual provider-backed drafts                 | Yes             | Yes, UIDPLUS required |
| Provider-backed draft autosave                 | Yes             | Yes, UIDPLUS required |
| Browser-local interrupted-compose recovery    | Yes             | Yes                  |
| Provider draft attachments                    | Not implemented | Not implemented      |
| Scanned attachment upload/send (18 MiB total) | Yes             | Yes                  |
| Authenticated attachment download (50 MiB)    | Yes             | Yes                  |
| Download all ZIP (100 files / 200 MiB)        | Yes             | Yes                  |
| Scanned forwarding of original attachments    | Yes             | Yes                  |
| Scanned plain-text preview (1 MiB)            | Yes             | Yes                  |
| Verified inline CID JPEG/PNG/WebP             | Yes             | Yes                  |
| Conversation/thread API                       | Not implemented | Not implemented      |
| Push/new-mail subscription                    | Not implemented | Not implemented      |

Both adapters receive the same validated, case-insensitively deduplicated
To/CC/BCC set. Each connection is limited to 30 send requests and 300 normalized
recipients per one-minute in-process window. Stalwart JMAP also caps each
decoded JSON response at 16 MiB, retains only the first 100 entries of each
provider-supplied To, CC, BCC, From, and Reply-To array, and bounds
sender-controlled address and summary text before mapping it into the
provider-independent domain. Detailed reads request no more than 256,000 bytes
per body value, retain no more than 128 referenced body values within a 256,000
character aggregate source budget, and cap each final text or sanitized HTML
presentation at 256,000 characters with a visible truncation marker.

Both adapters use a fixed server-owned page size of 50 behind an opaque signed
cursor. The public cursor expires after 30 minutes and is bound to its mailbox,
search, sort, preview mode, and page size; clients cannot safely inspect,
increment, or reuse it in another context. Stalwart maps its internal position
to `Email/query` and orders `receivedAt` newest-first or oldest-first. Standard
IMAP sorts matching UIDs descending or ascending before applying its position.
UID order reflects mailbox arrival/order and is not guaranteed to equal the
message's sender-controlled `Date` header. The browser permits one next-page
request at a time, drops duplicate message IDs across adjacent pages, rejects
stale page completions after mailbox/search/session/preference changes, and
keeps an already open message selected. Refresh deliberately restarts from the
first page so new-mail movement cannot silently rewrite an accumulated list.

Density, order, and preview visibility are encrypted Veda Mail account
preferences and require no provider setting. Stalwart requests JMAP `preview`
only when enabled, then Veda Mail removes control/bidirectional characters,
collapses whitespace, and enforces 320-character and 1,024-byte limits.
Standard IMAP summary listing deliberately fetches no body or source bytes, so
its message-list preview remains empty even when the preference is enabled.
This limitation does not affect opening a message and is unrelated to the
explicit malware-scanned attachment preview feature.

Multi-select is also provider-independent and applies only to messages loaded
in the current browser view. The strict bulk route accepts at most 100 unique
message IDs, runs no more than four provider mutations concurrently, and
returns separate succeeded/failed ID lists without upstream error details.
JMAP uses keyword patches, mailbox replacement, and `Email/set/destroy`.
IMAP uses UID flag updates, UID move, and UID EXPUNGE only after the scoped
message identity and current mailbox `UIDVALIDITY` match. Spam is an ordinary
move to the provider mailbox mapped to the `spam` role. Permanent delete is
shown only in Spam or Trash and requires an explicit confirmation. No provider
profile, Stalwart setting, schema migration, or additional network port is
required.

Empty Spam/Trash uses a distinct prepare-first operation and removes at most
100 messages per provider call. JMAP records the confirmation query state and
aborts if `Email/queryChanges` reports a later addition, even when that message
has an older received date. Standard IMAP captures `UIDNEXT - 1`, validates
`UIDVALIDITY` and optional OBJECTID on every resume, scans only bounded UID
windows, and requires UIDPLUS targeted expunge. A server without UIDPLUS can
still use ordinary Trash moves, but Veda Mail will fail closed instead of
offering unsafe whole-mailbox expunge semantics.

Both adapters also receive the same server-canonicalized content contract:
required readable `body` plus optional safe `htmlBody`. When rich content is
submitted, Veda Mail derives `body` from the sanitized HTML rather than
trusting the browser-supplied fallback. Standard SMTP sends matching
`text/plain` and `text/html` alternatives, nested inside `multipart/mixed`
when attachments exist. Stalwart JMAP sends matching body values and
`textBody`/`htmlBody` declarations, or an explicit
`multipart/alternative` nested inside `multipart/mixed` for attachments.
Plain messages remain text-only in both adapters.

Rich-text send is a Veda Mail application feature. It requires no provider
profile change, Stalwart configuration change, mailbox data migration, or new
mail-server port.

Email signatures are also a provider-independent Veda Mail feature. They are
stored as encrypted per-provider/mailbox preferences on the Veda Mail `/data`
volume, not as Stalwart identities or IMAP/SMTP provider settings. Selecting a
signature inserts its already canonical plain/rich pair into the composer; the
complete message then passes the ordinary server sanitizer before either
adapter sees it. Stalwart receives normal JMAP message body values and Standard
SMTP receives normal MIME alternatives.

No Stalwart configuration, database/schema change, mailbox migration, API
extension, or new port is required. Because these are Veda-local preferences,
they do not automatically appear in Stalwart's own webmail, a desktop client,
or another Veda Mail deployment unless the matching `/data` state is restored.

Both adapters expose a runtime-gated manual draft workflow. Veda Mail can
create, open, update, discard, and send simple provider-backed drafts in the
account's provider Drafts mailbox. For JMAP, a stable compose UUID and
canonical-content fingerprint are stored as advisory non-system keywords,
never as transmitted mail headers. Updating creates and verifies an immutable
replacement before destroying the prior draft in a separate conditional `Email/set`; retry
reconciliation prevents a lost HTTP response from creating duplicate drafts
without assuming a multi-object `/set` is atomic. Sending is deliberately
save-first: the server reloads and verifies the exact immutable draft, claims it
against concurrent senders, then creates a fresh copy and submits its RFC
creation reference in one ordered batch. It accepts only an exact submission
and implicit Drafts-to-Sent result, then cleans up the claimed old draft. An
ambiguous issued outcome remains visibly locked, instructs the member to check
Sent, and is never blindly retried.

Standard IMAP stores the same canonical content as ordinary MIME in the
special-use `\\Drafts` mailbox. It requires UIDPLUS so an exact UID can be
expunged without removing unrelated messages already marked `\\Deleted`.
Account-scoped opaque IDs bind mailbox, UID, and UIDVALIDITY. Bounded Veda
compose, content-fingerprint, reply, and write markers are private draft
headers; SMTP submission reconstructs a fresh message and never transmits
them. Creates and immutable append-before-delete replacements are parsed back
and fingerprint-verified before success. An in-process per-account/compose
lock serializes saves and sends on the supported single replica; header search
recovers an APPEND whose UID response was lost. Standard IMAP cannot provide a
cross-replica atomic compare-and-swap, so a truly external concurrent client
can cause a safe conflict or leave a duplicate draft, but cannot make Veda
silently overwrite unverified content.

Provider-supplied HTML still crosses the normal presentation sanitizer before
the composer sees it. BCC remains in the private provider draft. Drafts with
provider attachments, local quarantine attachments, incomplete/truncated body
values, duplicate or unsupported top-level headers, named address groups, or a
non-canonical MIME tree are not destructively rewritten or sent; bounded
unsupported drafts remain closeable, copyable, and explicitly discardable.
Provider draft attachments remain roadmap work. Session-bound local
interrupted-compose recovery and debounced provider autosave with offline pause
work for both adapters; JMAP has conditional-state reconciliation while IMAP
uses UIDPLUS, fingerprint verification, and serialized header reconciliation.

The Standard IMAP + SMTP adapter omits BCC from delivered MIME while retaining
it in the SMTP envelope. If SMTP immediately rejects only some recipients, Veda
Mail follows the normal Sent-copy append attempt and returns a partial-delivery
receipt containing only case-insensitive matches from the submitted set. The
authenticated member sees a bounded warning not to resend to everyone. If every
recipient is rejected, Veda Mail returns a generic safe failure and does not
append a Sent copy; raw provider errors and recipient-bearing causes do not
reach request logs.

Known Nodemailer DNS, TLS, required-TLS, authentication, envelope,
message-construction, OAuth, configuration, and proxy failures are definite
pre-submission failures and remain retryable behind a safe generic response.
Timeout, socket/connection, and unknown failures from `sendMail` are terminal
uncertain because SMTP acceptance may have happened before the response was
lost; these outcomes contain no recipient list and skip the normal Sent-copy
append.

All adapter receipts cross a runtime canonicalization boundary. A malformed,
contradictory, oversized, or unsubmitted rejection result is returned as a
terminal uncertain outcome with no provider values. The member must check Sent
or the provider before retrying; quarantined attachments are consumed because
submission may already have occurred.

The Stalwart adapter keeps identity discovery, uploads, session refresh, safe
origin checks, and other preflight work retryable. Once the final
`Email/set` + `EmailSubmission/set` HTTP request is issued, an indeterminate
transport response, malformed/missing result, contradictory result, or
`serverPartialFail` becomes terminal uncertain. Unambiguous created results
accept; an explicit unambiguous `EmailSubmission` not-created result and
ordinary state-unchanged JMAP method errors remain retryable. Sanitized,
request-level 400/401/403/404/405/409/413/415/422/429 responses are also
retryable because methods were not executed; 408, 5xx, response-read/parse
failure, or transport loss remains uncertain. Non-OK response bodies are
canceled before the adapter returns.

Every browser send includes a stable draft UUID. Veda Mail reserves that key
against an exact fingerprint of the validated provider-bound intent before
attachments or either adapter are touched. Concurrent duplicates coalesce and
completed terminal receipts replay for 30 minutes from completion, capped by
the connection expiry. A changed intent conflicts and exhausted bounded
capacity fails closed. This protection is in-process and requires the supported
single application replica.

Partial and uncertain warnings remain available across ordinary page reloads
while their in-process connection bucket remains present. They are bounded to
100 records per opaque connection ID, never stored in browser storage, and
compressed to an explicit overflow warning under detail pressure. A defensive
12-hour expiry plus process-wide limits of 128 buckets, 2,000 notices, and an
estimated 8 MiB bound memory. Count or byte pressure first compresses old detail
to a sentinel; once the connection-key cap is full, a new connection bucket is
not admitted and existing connection buckets are left intact. Bucketless
detail for the refused connection is represented by one boolean on its
already-existing verified connection record, without adding a notice-map key.
Only that connection sees the metadata-free warning, which can reappear after
local dismissal until the connection ends. This convenience queue does not
survive a service restart or synchronize across replicas.

Scanned attachments require the Compose-managed ClamAV sidecar independently
of the selected provider. The approved zero-HIGH/CRITICAL ClamAV digest is
currently published for `linux/amd64` only, so run
`./scripts/check-clamav-platform.sh` before starting either provider topology.
The preflight rejects unsupported architectures; there is no unscanned
fallback.

Received attachments use a separate capability and 50 MiB decoded-byte
ceiling; the outbound 18 MiB upload/send limit does not describe downloads.
The browser receives only an opaque attachment ID scoped to its message. JMAP
downloads require and verify the provider's exact content length while
streaming. IMAP downloads revalidate `UIDVALIDITY` and `BODYSTRUCTURE`, resolve
the server-only MIME part, and stream without claiming a `Content-Length`.
Veda Mail consumes either provider stream once into an encrypted, scope-bound
temporary spool, hashes it, and requires a complete clean ClamAV verdict before
the same bytes can enter a non-cacheable, non-transformable attachment response.
Download all first
performs a signal-aware provider classification lookup that may
inspect bounded message presentation data so it returns exactly the current
visible/downloadable file-card metadata. It then stages and scans each
revalidated attachment sequentially; only after all entries are clean does it
stream their verified copies into one STORE-mode ZIP. The browser supplies only the
opaque message ID; generated names are flat, sanitized, and collision-safe. The
archive is capped at 100 files, 50 MiB per file, and 200 MiB actual decoded
payload. Byte ranges are not implemented.

Received inline CID images use a separate, fail-closed display path for JPEG,
PNG, and WebP. JMAP derives candidates from the authenticated message's
attachment and HTML-body metadata, including supported ordered `htmlBody`
image parts without a textual `cid:` reference. IMAP derives them from the current
`BODYSTRUCTURE` and revalidates `UIDVALIDITY` and the MIME part before download.
Only a unique provider-verified Content-ID can replace the matching `cid:` URL
with an opaque, message-scoped attachment marker. Remote, data, blob,
unsupported, missing, and ambiguous image references remain blocked.

The reader issues an authenticated same-origin `POST` with only the opaque
message and attachment IDs. The server accepts at most 5 MiB of source bytes,
requires a complete clean ClamAV verdict and an exact supported magic-number
match, validates the raster container, and uses Sharp to decode and re-encode
one metadata-free WebP. Input dimensions are bounded at 4,096 pixels and
16 megapixels; output fits within 1,600 by 1,600 pixels. At most eight verified
images are rendered per message.

The WebP is passed as a browser Blob to the message frame rather than exposed as
a provider URL. That frame has an opaque origin because its sandbox omits
`allow-same-origin`; its child CSP permits `blob:` images but no network
connections. Existing authenticated JMAP download and IMAP access are
sufficient, so this feature requires no Stalwart server configuration change.

Unsupported or ambiguous sequential JMAP media stays visible as an attachment
fallback. An eligible transient 429 or 503 inline-image response receives at
most two abort-aware automatic retries. After exhaustion the sanitized alt text
remains; an accessible parent-side control retries only failed opaque
attachment IDs and remains bounded and fail-closed.

Plain-text preview is a separate explicit POST using the same opaque
message-scoped lookup. It fetches once, caps provider bytes at 1 MiB, requires
a full clean ClamAV verdict, verifies `text/plain` by hint and magic, validates
the whole UTF-8/control surface, and returns only inert text in a
script-disabled Blob frame. The only sandbox token is `allow-same-origin`
so the parent modal can contain keyboard focus; active behavior remains
disabled. Complex formats and raw inline bytes are never previewed. No provider
configuration or Stalwart change is required.

Forwarding originals uses the same authenticated, message-scoped lookup but
never reuses a provider blob directly. Veda Mail stages the decoded source
within the lower provider/outbound limit, scans and verifies it through the
encrypted quarantine, and sends only the resulting quarantine ID. IMAP's
unknown decoded size is measured in one bounded pass. The browser supplies no
filename, MIME type, size, blob ID, or MIME-part locator.

Only final visible file-card attachments are eligible. The client excludes
rendered and hidden inline parts before creating import jobs, and the server
independently re-lists authoritative attachment presentation metadata before
accepting the opaque ID. A stale, forged, rendered-inline, or hidden-inline ID
fails as not found.

No Stalwart server change is required. Veda Mail uses the authenticated JMAP
session's existing download URL and keeps its blob ID inside the adapter.
Direct received-attachment downloads and every Download all entry use a
separate request-scoped encrypted ClamAV quarantine sized for received mail.
They never reuse the lower outbound draft quarantine and never re-fetch a clean
provider object. Generated ZIPs preserve nested archives byte-identically and
never expand them. Forwarded originals continue through the outbound
quarantine before send.

| Adapter              | Use it for                                                | Authentication                               |
| -------------------- | --------------------------------------------------------- | -------------------------------------------- |
| Stalwart JMAP        | Self-hosted Stalwart                                      | Stalwart OAuth flow                          |
| Standard IMAP + SMTP | Hostinger, cPanel, Zoho, Fastmail, and compatible hosting | Full email address plus mailbox/app password |

Member authenticator 2FA is supplied by Veda Mail for both adapters. It does
not require a mailbox-management API.

## Configure Standard IMAP + SMTP

Before saving the provider, add both public mail hostnames to the deployment
allowlist. Hostnames do not include a scheme or port:

```dotenv
VEDA_MAIL_ALLOWED_PROVIDER_HOSTS=imap.example.com,smtp.example.com
```

Redeploy after changing an environment variable. In `/admin`, open the mail
service settings and choose **Standard IMAP + SMTP**. Enter:

- IMAP host and port from the provider's incoming-mail instructions
- IMAP security: `TLS` for port 993, or `STARTTLS` when explicitly documented
- SMTP host and port from the outgoing-mail instructions
- SMTP security: `TLS` for port 465, or `STARTTLS` for port 587
- SMTP maximum message bytes: leave `0` to require the server's authenticated
  EHLO `SIZE` value, or enter the smaller documented provider/plan ceiling
  when the server omits a numeric `SIZE` limit
- Every organization domain whose members may sign in

Plaintext IMAP and SMTP are intentionally unsupported. The server must have a
publicly trusted TLS certificate. Private-network targets are blocked unless a
deployment explicitly extends the network policy in source code.

The adapter caches the verified SMTP limit for five minutes, subtracts
base64 line expansion plus a conservative MIME/header reserve from the picker
limit, and checks the exact composed message again before SMTP submission.
The lower of the advertised and administrator-configured limits always wins.
Attachments stay disabled when neither source supplies a numeric ceiling;
ordinary messages remain available.

After saving, test with a dedicated mailbox:

1. Sign in using its complete email address and mailbox or app password.
2. Open Inbox and another folder.
3. Search for a known message.
4. Send to an external address.
5. Reply externally and confirm it arrives.
6. Confirm the sent copy appears in the Sent folder.
7. Send a small known-clean attachment and verify its received SHA-256 digest.
8. Download the received attachment and verify its SHA-256 digest again.
9. Download a multi-attachment message as one ZIP, run an independent archive
   integrity check, and verify every extracted SHA-256 digest.
10. For JMAP, lower `maxSizeUpload` in a test session and confirm the UI and
    reservation endpoint enforce the advertised provider limit before upload.
11. For SMTP, test a lower EHLO `SIZE` or administrator ceiling and confirm both
    the picker and exact final MIME message fail before provider submission.
12. With a controlled SMTP test server, reject one recipient and then all
    recipients. Confirm partial delivery lists only the rejected submitted
    address, warns against resending to everyone, and all-rejected delivery
    leaves no Sent copy.
13. Archive, star, move, and trash a test message.
14. Move one message and a multi-selection by drag/drop, then repeat from the
    keyboard/touch Move control. Confirm partial failures remain selected.

## Message move requirements

JMAP providers must expose `Mailbox/myRights.mayAddItems` and
`mayRemoveItems`. Veda reads the current Email state and membership, then uses
a state-conditioned `Email/set` patch for only the exact source and destination
membership keys. A single state-mismatch retry refreshes that snapshot; other
mailbox memberships are retained.

The standard adapter requires the server to advertise native IMAP MOVE. Veda
verifies the canonical source mailbox, UIDVALIDITY, exact UID, destination
existence, and selectability before moving. It intentionally does not fall back
to COPY plus EXPUNGE, even on servers where that means move is unavailable,
because plain EXPUNGE can remove unrelated messages. No Stalwart configuration
change is required beyond ordinary JMAP mailbox rights.

## Common provider examples

Always prefer the values shown in the account's current provider control
panel; regional and plan-specific values can differ.

### Hostinger Email

Hostinger's published settings are:

```text
IMAP host:      imap.hostinger.com
IMAP port:      993
IMAP security:  TLS
SMTP host:      smtp.hostinger.com
SMTP port:      465
SMTP security:  TLS
```

Hostinger also documents SMTP port 587 with STARTTLS as a fallback. Use the
complete email address and mailbox password.

### cPanel or private hosting

In cPanel, open **Connect Devices** for a mailbox and copy the secure incoming
and outgoing settings. Hosts are commonly `mail.your-domain.example`, but
never assume this value. Use the full mailbox address as the username.

### Zoho Mail

Zoho publishes `imap.zoho.com:993` and `smtp.zoho.com:465` for many personal
accounts. Paid organization accounts may use `imappro.zoho.com:993` and
`smtppro.zoho.com:465`. Check the exact server configuration inside the Zoho
account because the data center and plan can change it. Enable IMAP in Zoho.
When Zoho 2FA is enabled, use an application-specific password.

### Google Workspace or Gmail

The current generic adapter supports password-style IMAP authentication. Google
recommends **Sign in with Google** instead. An app password may work only when
Google 2-Step Verification and the organization's policy permit app passwords.
It is not available for every Workspace or Advanced Protection account.

For a production Google integration, contribute a Google OAuth provider
adapter instead of asking members for their main Google password.

### Microsoft 365 or Outlook.com

Do not use a normal Microsoft password with this generic adapter. Exchange
Online removed Basic authentication for IMAP and requires OAuth 2.0; SMTP AUTH
also has tenant controls and modern-auth requirements. A Microsoft Entra OAuth
adapter is therefore required for a dependable Microsoft 365 integration.

## What “provider-independent” means

Veda Mail is not dependent on Stalwart in its domain, UI, sessions, member 2FA,
or local email signatures. Any new adapter can implement the stable
`ProviderModule` and `MailGateway` contracts.

It does not mean every vendor is automatically compatible. A service must
offer either:

- standard IMAP and authenticated SMTP accepted by the included adapter, or
- a custom adapter for its API and authentication system.

Provider-side mailbox creation, password resets, aliases, quotas, retention,
and direct-provider login remain controlled by that provider unless its
adapter explicitly implements them. The Stalwart adapter implements bounded
user list/detail/create behind a separate server-only management key; it does
not expose a generic administrative JMAP passthrough.

## Official references

- [Hostinger email client configuration](https://support.hostinger.com/en/articles/1575756-how-to-get-email-account-configuration-details-for-hostinger-email)
- [Zoho IMAP and SMTP configuration](https://www.zoho.com/mail/help/imap-access.html)
- [Google app passwords](https://support.google.com/mail/answer/185833)
- [Google third-party mail clients](https://support.google.com/mail/answer/7126229)
- [Microsoft OAuth for IMAP and SMTP](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
