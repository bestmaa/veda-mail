# Administrator-managed mail forwarding

Veda Mail supports one automatic external forwarding destination per mailbox
when the active provider is Stalwart and the server-side management integration
is configured. Members cannot create, edit, or disable forwarding. They receive
a read-only notice in Account settings when an administrator has configured it.

## Product and security policy

- Forwarding is disabled by default and may be changed only in **Admin › Mailbox
  users › Mailbox details**.
- The administrator must re-enter the destination and complete password step-up;
  an OTP or recovery code is also required when administrator 2FA is enabled.
- Re-entry is an administrator attestation, not proof that the external mailbox
  is owned by the intended person. Verify ownership and consent out of band.
- Only external destinations are accepted. The primary address and every alias
  on managed Veda Mail domains are rejected as destinations to reduce loops.
- Stalwart uses Sieve `redirect :copy`, so the local mailbox always keeps a copy.
- One destination is supported in version 1. This limits accidental disclosure
  and keeps review, revocation, and reconciliation unambiguous.
- The complete generated Sieve program has a 256 KiB safety ceiling and is
  validated before desired state is committed. Capacity failure does not alter
  the existing provider program or forwarding ledger.
- Changes use a revision precondition. A stale admin page receives a conflict
  instead of overwriting a newer setting.

Forwarding is data disclosure. An administrator should record a business reason,
confirm the destination owner, review active forwards regularly, and disable a
forward immediately when access or employment changes.

## Provider execution model

Veda Mail owns the Stalwart system script named
`veda-mail-admin-forwarding-v1`. It deterministically compiles all active primary
addresses and aliases into envelope-recipient rules and selects the script in
the SMTP DATA stage. It never uses a member password or administrator
impersonation. The generated script carries a deployment-key-authenticated
ownership marker. A script that merely reuses the reserved name or description
without a valid marker is treated as an operator-owned conflict and is never
overwritten.

The integration is fail-closed. If the DATA stage selects any other script,
Veda Mail reports a provider conflict and does not replace it. An operator must
merge the scripts deliberately or free the DATA stage before enabling this
feature. Veda Mail leaves its empty script selected after the last forward is
removed; this avoids rewriting unrelated provider configuration on each toggle.

Use a dedicated API key bound by
`VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN`. In addition to the read permissions used
by mailbox administration, forwarding needs:

```text
sysMtaStageDataGet
sysMtaStageDataUpdate
sysSieveSystemScriptQuery
sysSieveSystemScriptGet
sysSieveSystemScriptCreate
sysSieveSystemScriptUpdate
```

Do not grant `impersonate`, mailbox protocol access, script destroy, or broader
configuration permissions for this workflow.

## State, audit, and reconciliation

The authoritative forwarding ledger is AES-256-GCM encrypted. Local mode writes
`mail-forwarding.enc.json` with mode `0600`; shared mode migrates the encrypted
record to Redis and updates it with exact-record CAS. `VEDA_MAIL_JOB_KEY` derives
the record key, so it must be backed up and restored with the deployment secrets.

The provider is reconciled from the complete desired ledger after every change.
`applying`, `active`, and `error` states make uncertain provider outcomes visible.
If disabling fails, Veda Mail restores the previous desired record as `error`
rather than claiming that forwarding stopped. Audit entries record attempts and
outcomes as `admin.mail-forwarding.enabled` or
`admin.mail-forwarding.disabled`; destination addresses are not put in audit
targets or application logs.

## Delivery caveats

External forwarding is not guaranteed delivery. SPF alignment can be lost and a
strict DMARC policy may cause Gmail or another destination to reject the
redirected message. Test representative senders before relying on forwarding,
monitor the Stalwart outbound queue, and prefer a provider-supported SRS design
when the installed Stalwart release supports it. Veda Mail does not rewrite the
original message identity.

## Deployment and verification

1. Back up encrypted application state and provider configuration.
2. Create the least-privilege Stalwart API key and set the two management
   environment variables on every Veda Mail replica.
3. Confirm `VEDA_MAIL_JOB_KEY` is stable and shared-state Redis is persistent
   for a multi-replica deployment.
4. Deploy Veda Mail, open one test mailbox, and enable a controlled external
   destination.
5. Send mail from local, SPF-only, and strict-DMARC senders. Confirm both the
   Veda mailbox copy and the external copy, then inspect the outbound queue.
6. Disable the test forward, send again, and confirm external delivery stopped.
7. Review the security audit and member read-only notice.

Rollback the application normally. Before removing the provider script, disable
all forwarding records and verify the generated script contains no redirects.
Never delete or replace another DATA-stage script as part of rollback.
