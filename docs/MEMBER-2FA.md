# Member authenticator 2FA

Veda Mail provides its own RFC 6238 TOTP verification layer for every mail
provider. A member can use Google Authenticator, Microsoft Authenticator,
Authy, 1Password, or another standards-based TOTP app.

## Enable

1. Sign in to Veda Mail.
2. Open account settings.
3. Under **Authenticator verification**, choose **Set up authenticator**.
4. Scan the QR code or enter the displayed setup key.
5. Enter the current mailbox password and the 6-digit code.
6. Save all ten one-time backup codes before leaving the screen.

The next Veda Mail sign-in requires:

1. Full mailbox address and provider password/app password.
2. A current 6-digit authenticator code or one unused backup code.

Each backup code works once. Veda Mail stores only a salted digest of each
backup code and never shows the codes again.

## Storage and security

Member 2FA records live in:

```text
${VEDA_MAIL_DATA_DIR}/member-security.json
```

The TOTP URI is encrypted with AES-256-GCM using a key derived from the
installation session secret. The member email is authenticated as encryption
context so records cannot be swapped between accounts. The file is created
with mode `0600` and updated atomically.

Back up the complete `/data` volume. Restoring only `installation.json` without
`member-security.json`, or restoring the two files from different points in
time, can lose or invalidate member 2FA state.

Mailbox passwords and messages are not written to this file. Provider
credentials remain only in the process-local member session and disappear on
restart.

## Lost phone

Use an unused backup code in the normal Veda Mail verification field. After
sign-in, disable the old authenticator and enroll a new one.

There is deliberately no public “email me a reset link” endpoint because Veda
Mail cannot safely prove mailbox ownership without first opening that mailbox.
If the phone and every backup code are lost, an organization administrator must
use an audited recovery procedure or remove that mailbox's record from a
stopped-service backup workflow. A dedicated member recovery CLI is a future
extension; do not hand-edit the JSON file while Veda Mail is running.

## Important boundary

Veda-managed 2FA protects only the Veda Mail sign-in and Veda Mail session. It
cannot add 2FA to:

- the provider's own webmail page,
- a desktop/mobile client connecting directly to IMAP/SMTP,
- a mailbox-management panel, or
- another application using the same provider credentials.

Enable provider-native MFA as well when available. If provider-native MFA and
Veda MFA are both enabled, the provider adapter must be able to complete its
own authentication first. Custom OAuth adapters should handle the provider's
challenge and then allow Veda's independent second factor to run.
