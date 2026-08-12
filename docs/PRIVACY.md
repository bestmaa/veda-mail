# Privacy and data lifecycle

Veda Mail is self-hosted software. The organization operating a deployment,
not the upstream project, decides why mailbox and account data is processed,
who may access it, where it is hosted, and how long it is retained. Operators
must publish a notice suited to their jurisdiction and deployment. This guide
is technical documentation, not legal advice.

## Data flow

The browser talks only to Veda Mail. Veda Mail authenticates to the configured
JMAP or IMAP/SMTP provider and returns bounded presentation data. It does not
contain advertising, analytics SDKs, or upstream Veda telemetry. Remote images
in messages are blocked. A provider, reverse proxy, DNS resolver, malware
scanner, optional Redis rate/shared-state stores, container platform, backup
service, and operator log system may still process data under the operator's
configuration.

Mailbox messages and provider folders stay on the mail provider. Veda Mail
handles message headers, bodies, search terms, recipients, attachments, drafts,
and calendar parts as needed for the requested mail operation. Received files
may pass through the encrypted malware-scan spool and are deleted after
delivery, cancellation, failure, or expiry. See the [threat model](THREAT-MODEL.md).

## Durable local data

The `/data` volume can contain installation/admin credentials, branding,
provider configuration, organization policies, encrypted member 2FA,
signatures, templates, contacts, imported calendar events, preferences, saved
searches, labels, rules, scheduled-send and snooze jobs, and a pseudonymous
security audit chain. The exact inventory and key dependencies are in the
[backup guide](BACKUP-AND-RECOVERY.md).

Owner buckets use a verified provider/account scope. Sensitive member records
are encrypted at rest with installation- or deployment-derived keys. Encryption
does not make the volume anonymous: the same backup can contain its decryption
material, and traffic/log metadata can identify a mailbox.

## Retention and controls

| Data class | Default lifetime | Available control |
| --- | --- | --- |
| Member/admin browser sessions | 30-minute idle/12-hour absolute limit; process restart in local mode, or encrypted Redis TTL when shared state is configured | Sign out or revoke from session inventory; Redis operator lifecycle |
| Interrupted compose recovery | Exact browser session only | Discard, sign out, or clear site data |
| Pending upload/scan files | 15â€“30 minute bounded spool lifetime | Automatic EOF/cancel/failure/expiry cleanup |
| Signatures, templates, contacts, groups, saved searches, imported events, labels and preferences | Until the member deletes/replaces them or `/data` is removed | Corresponding member settings controls and whole-volume lifecycle |
| Rules and vacation response | Until disabled/deleted or replaced at the provider | Member rule/vacation controls; provider state may outlive local rollback |
| Scheduled/Undo Send and snooze jobs | Until completion, cancellation, terminal review removal, or bounded expiry | Member scheduled/snooze controls |
| Security audit | 365 days or 10,000 records, whichever is stricter | Administrator Audit log retention: 1â€“3,650 days and 100â€“10,000 records |
| Structured application/proxy logs and metrics | Operator-defined; Veda does not own the external sink | Configure redaction and bounded sink retention |
| Backups | Operator-defined | Rotate encrypted generations and securely delete expired copies |
| Provider mailbox data | Provider/operator-defined | Provider mailbox and retention administration |

Lowering audit retention applies immediately and irreversibly to the live
volume. Expiration increments the dropped count and advances the authenticated
chain anchor, so retained records remain verifiable. A valid older backup can
still contain expired records; backup rotation must enforce the same policy.

Deleting local Veda metadata does not delete provider messages, an already
submitted email, provider-native rules/vacation state, external logs, or backup
generations. Likewise, deleting provider mail does not automatically erase
local contacts, preferences, audit evidence, or browser recovery data.

## Notifications and exports

Web Notifications are opt-in. The privacy-safe default omits sender and subject;
the member must explicitly enable richer notification text. Operating-system
notification history is outside Veda Mail's control.

Exports contain user-requested data and are delivered as private, non-cacheable
downloads. Treat vCard, ICS, JSON, EML, ZIP, screenshots, and audit exports as
sensitive. Veda Mail does not upload them to an upstream service.

## Operator responsibilities

- Limit administrator, platform, backup, log, and provider access.
- Use HTTPS, encrypted storage/backups, secret management, and documented key
  rotation or restore procedures.
- Set audit and external-log retention to a documented business/legal need.
- Record subprocessors and cross-border data flows introduced by deployment.
- Provide a contact and process for access, correction, export, deletion, legal
  hold, and incident requests; verify identity before acting.
- Reconcile every request across Veda `/data`, provider data, browser/OS state,
  external logs, scanners, metrics, and backup generations.
- Never claim that pseudonymization, encryption, or deletion from the live
  volume erased independent provider or backup copies.

## Privacy review triggers

Review this document when adding a provider, remote service, telemetry, durable
store, browser storage, notification field, export/import format, log label,
administrator view, background job, or new data recipient. Update the threat
model and release checklist in the same change.
