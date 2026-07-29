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
| Plain-text send, To/CC/BCC                    | Yes             | Yes                  |
| Read/star/archive/move/trash                  | Yes             | Yes                  |
| Profile/password/provider 2FA management      | Yes             | No                   |
| Provider-backed drafts/autosave               | Not implemented | Not implemented      |
| Scanned attachment upload/send (18 MiB total) | Yes             | Yes                  |
| Authenticated attachment download             | Not implemented | Not implemented      |
| Conversation/thread API                       | Not implemented | Not implemented      |
| Push/new-mail subscription                    | Not implemented | Not implemented      |

Scanned attachments require the Compose-managed ClamAV sidecar independently
of the selected provider. The approved zero-HIGH/CRITICAL ClamAV digest is
currently published for `linux/amd64` only, so run
`./scripts/check-clamav-platform.sh` before starting either provider topology.
The preflight rejects unsupported architectures; there is no unscanned
fallback.

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
8. For JMAP, lower `maxSizeUpload` in a test session and confirm the UI and
   reservation endpoint enforce the advertised provider limit before upload.
9. For SMTP, test a lower EHLO `SIZE` or administrator ceiling and confirm both
   the picker and exact final MIME message fail before provider submission.
10. Archive, star, move, and trash a test message.

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

Veda Mail is not dependent on Stalwart in its domain, UI, sessions, or member
2FA. Any new adapter can implement the stable `ProviderModule` and
`MailGateway` contracts.

It does not mean every vendor is automatically compatible. A service must
offer either:

- standard IMAP and authenticated SMTP accepted by the included adapter, or
- a custom adapter for its API and authentication system.

Provider-side mailbox creation, password resets, aliases, quotas, retention,
and direct-provider login remain controlled by that provider unless its
adapter explicitly implements them.

## Official references

- [Hostinger email client configuration](https://support.hostinger.com/en/articles/1575756-how-to-get-email-account-configuration-details-for-hostinger-email)
- [Zoho IMAP and SMTP configuration](https://www.zoho.com/mail/help/imap-access.html)
- [Google app passwords](https://support.google.com/mail/answer/185833)
- [Google third-party mail clients](https://support.google.com/mail/answer/7126229)
- [Microsoft OAuth for IMAP and SMTP](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
