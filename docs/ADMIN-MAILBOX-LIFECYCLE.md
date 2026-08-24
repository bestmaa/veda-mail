# Administrator mailbox-user lifecycle

Veda Mail exposes mailbox-user lifecycle actions only under **Admin → Mailbox
users → Mailbox details** and only for the Stalwart JMAP management adapter.
Member routes do not expose these operations.

## Disable access versus delete

**Disable access** removes the Stalwart account's complete credential
collection, revokes every active Veda member session indexed to the exact
mailbox address, removes Veda-managed forwarding, and leaves mailbox data in
Stalwart. Stalwart v0.16 does not expose a reversible `isEnabled` account
property, so this is deliberately called disable rather than suspend.
Re-enabling requires a provider operator to assign new credentials.

**Delete permanently** performs the same forwarding/session cleanup and then
passes only the provider-resolved account ID to `x:Account/set` `destroy`.
Stalwart permanently deletes the account and its data. A Veda backup does not
contain provider messages and cannot restore them.

Both flows require:

- an authenticated Veda administrator session and same-origin request;
- the current administrator password;
- the configured TOTP or one unused backup code;
- the full mailbox email typed exactly; and
- a UUID `Idempotency-Key` bound to operation, account, profile revision, and
  mailbox address.

## Protected accounts and provider permissions

Veda always protects `postmaster@…` and `abuse@…`. Add integration and
automation addresses to the comma-separated
`VEDA_MAIL_PROTECTED_MAILBOXES` environment value. Protection is returned as a
safe capability to hide the controls and is rechecked server-side before the
provider request.

Grant `sysAccountUpdate` for disable and `sysAccountDestroy` for delete in
addition to the read permissions documented in
[mail-server setup](MAIL-SERVER-SETUP.md#stalwart-mailbox-user-management).
The browser never supplies roles, permissions, credentials, or an arbitrary
provider account ID.

## Retry and partial-failure runbook

The shared mailbox-operation ledger stores only an HMAC intent fingerprint and
safe result for 24 hours. Reusing the same key and intent replays that result;
reusing it for another intent is rejected. A crash or persistence failure after
an outcome may have changed leaves the key orphaned and blocks a blind retry.

Lifecycle ordering is forwarding cleanup, member-session revocation, then the
provider mutation. Therefore a failure before the final call may leave the
mailbox intact with forwarding removed and sessions revoked; this is safe to
retry with the same key after correcting the confirmed error. If the API
returns `MAIL_USER_LIFECYCLE_OUTCOME_UNKNOWN`, do not use a new key. Inspect the
exact account in Stalwart and correlate the Veda audit entry/request ID first.

Audit outcomes mean:

- `success`: the provider confirmed the action and the safe replay result was
  persisted;
- `failure`: no lifecycle step was known to have changed state; and
- `partial`: forwarding, a session, or the provider may have changed before a
  later failure.

After a successful disable, verify new member login fails, all prior Veda tabs
are signed out, forwarding is absent, and mailbox data still exists. After a
successful delete, verify the account is absent in Stalwart and no forwarding
entry remains.

Provider references: [Stalwart Account object](https://stalw.art/docs/ref/object/account/)
and [Stalwart permissions](https://stalw.art/docs/ref/permissions/).
