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
| Server-side text search                       | Yes             | Yes                  |
| Plain and safe rich-text send, To/CC/BCC      | Yes             | Yes                  |
| Per-identity email signatures                 | Yes             | Yes                  |
| Read/star/archive/move/trash                  | Yes             | Yes                  |
| Profile/password/provider 2FA management      | Yes             | No                   |
| Admin user list/detail/create                 | Yes, optional   | Unsupported          |
| Provider-backed drafts/autosave               | Not implemented | Not implemented      |
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
Veda Mail forces both paths to a non-cacheable, non-transformable attachment
response; the browser rejects malformed, oversized, dishonest, or truncated
streams before handing bytes to its download manager. Download all first
performs a signal-aware provider classification lookup that may
inspect bounded message presentation data so it returns exactly the current
visible/downloadable file-card metadata. It then streams each revalidated
attachment sequentially into one STORE-mode ZIP. The browser supplies only the
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
Direct received-attachment downloads are not passed through the outbound
ClamAV quarantine; members must continue to treat unexpected downloads as
untrusted files. Generated Download all ZIPs preserve that policy and never
expand nested archives. Forwarded originals do pass through quarantine before
send.

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
