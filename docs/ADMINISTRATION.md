# Organization administration

Open `/admin` and sign in with the administrator account created during
first-run setup. Mailbox users cannot use their mailbox credentials here.

## Organization identity

The organization settings control the member-facing sign-in and workspace:

- Organization name: 2–120 characters
- Product name: 2–80 characters
- Primary color: six-digit hexadecimal color
- Accent color: six-digit hexadecimal color
- Logo: PNG, JPEG, or WebP, at most 2 MB
- Public repository URL: an HTTPS URL or blank

Logos are decoded, auto-rotated, resized within 512×512 without enlargement,
and stored as WebP. Removing a logo restores the generated brand mark.

For an official unmodified deployment, the repository URL may remain
`https://github.com/bestmaa/veda-mail`. A modified network deployment should
link to the corresponding source of the running version; see
[open-source compliance](OPEN-SOURCE-COMPLIANCE.md).

## Administrator account

Administrator usernames:

- Are normalized to lowercase
- Are 3–64 characters
- Use letters, numbers, dots, underscores, or hyphens
- Must begin and end with a letter or number

Passwords:

- Are at least 12 characters
- Contain at least one letter and one number
- Are stored only as a scrypt salt and digest

Changing the username or password requires the current password and, when 2FA
is enabled, a current authenticator or unused backup code. A successful
change increments the authentication version, invalidates all older
administrator sessions, and signs the current administrator in with a
replacement session.

### Administrator two-factor authentication

Open **Security** in `/admin` and choose **Set up authenticator**. Scan the QR
code using Google Authenticator, Microsoft Authenticator, or any standards-based
TOTP app, then confirm with the current password and displayed 6-digit code.

Veda Mail displays ten one-time backup codes exactly once. Store them outside
the server in a password manager or protected offline copy. The authenticator
secret is AES-256-GCM encrypted in `/data`; backup codes are stored only as
salted digests. Changing the admin password does not disable 2FA.

2FA can be enabled only when the terminal recovery secret is configured. If
the phone and every backup code are lost, follow
[administrator recovery](BACKUP-AND-RECOVERY.md#administrator-recovery).

## Provider and domains

The mail-service settings contain:

- Provider adapter
- Display name
- Provider-specific service fields, such as the Stalwart HTTPS URL
- Allowed member email domains

An allowed domain only permits login attempts for that suffix. The mailbox
must already exist at the provider. Add every intended domain explicitly and
remove domains that are no longer authorized.

Use an exact HTTPS provider endpoint. In production,
`VEDA_MAIL_ALLOWED_PROVIDER_HOSTS` is required and the endpoint hostname must
match that list.

## Member lifecycle

Veda Mail does not create, suspend, delete, or reset provider mailboxes.
Perform those actions in Stalwart or the configured provider:

1. Create the provider mailbox and password.
2. Confirm its domain is allowed in Veda Mail.
3. Give the member the Veda Mail URL.
4. The member signs in using the full email address and mailbox password.

To revoke access, disable/reset the provider mailbox or remove its domain from
the allowed list. Restarting Veda Mail signs out all members because member
sessions are process-local.

## Routine checks

Monthly:

- Review allowed domains and provider hostname restrictions.
- Test administrator and a dedicated member account.
- Confirm backups and perform periodic restore rehearsals.
- Review application and provider logs for repeated failures.
- Install supported security updates.
- Confirm the public source link matches the running modified version.
