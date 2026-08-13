# Mailbox delegation

Veda Mail exposes mailbox delegation only when the active provider connection
advertises the standards-track IMAP `ACL` capability from RFC 4314. The first
release deliberately delegates `INBOX` only. It does not grant send-as,
account impersonation, password access, ACL administration, or access to other
mailboxes.

## Provider contract

| Connection | Delegation status |
| --- | --- |
| Standard IMAP/SMTP with `ACL` | Supported for `INBOX` |
| Standard IMAP/SMTP without `ACL` | Unsupported; no ACL command is sent |
| Stalwart JMAP | Unsupported until the JMAP session advertises a mail-sharing contract |
| Mock | Supported for deterministic browser acceptance |

RFC 4314 defines ACLs as mailbox-scoped identifier/right pairs and requires a
server to advertise `ACL` before clients use the commands. Veda Mail offers two
bounded presets rather than accepting arbitrary rights:

- **Read only** maps to `lr`: discover and read `INBOX` without changing seen
  state.
- **Manage mail** maps to `lrswite`: read, change seen/other flags, insert,
  mark deleted, and expunge. It excludes post, child-mailbox create/delete,
  and ACL administration rights.

The implementation uses `GETACL`, `SETACL`, and `DELETEACL`. Every mutation is
followed by a fresh `GETACL`; a request fails if the provider does not confirm
the exact requested preset or removal. Provider-returned owner, `anyone`,
`anonymous`, and negative-right entries are never exposed as editable
delegates, and mutations targeting those identities are rejected.

## HTTP and security contract

`GET`, `PUT`, and `DELETE /api/v1/member/delegation` require the exact current
mail-session scope. Writes additionally require same-origin JSON, bounded
request bodies, per-subject rate limits, and strict schemas. Account
identifiers are trimmed, byte-bounded, and reject controls and reserved
identities. Security-audit records store the action and target type only; they
never store the delegate identifier or provider credentials.

The settings UI calls the feature **Inbox delegation** and explicitly states
that it does not grant send-as identity. Unsupported connections render the
provider capability reason instead of inactive mutation controls.

References: [RFC 4314](https://datatracker.ietf.org/doc/html/rfc4314),
[Stalwart permissions and ACLs](https://stalw.art/docs/auth/authorization/permissions/).
