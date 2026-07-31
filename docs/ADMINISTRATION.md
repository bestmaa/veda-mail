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
must exist at the provider before a member can sign in; for an internal
Stalwart directory it may be created from **Mailbox users** as described below.
Add every intended domain explicitly and remove domains that are no longer
authorized.

Use an exact HTTPS provider endpoint. In production,
`VEDA_MAIL_ALLOWED_PROVIDER_HOSTS` is required and the endpoint hostname must
match that list.

For Standard IMAP + SMTP, allowlist both incoming and outgoing hostnames and
use only TLS or STARTTLS. Provider password resets and profile changes are not
available through these protocols. See [mail providers](PROVIDERS.md).

## Mailbox users

When the active provider is Stalwart JMAP and
`VEDA_MAIL_STALWART_MANAGEMENT_API_KEY` plus its exact HTTPS
`VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN` binding are configured, **Mailbox users**
can:

- List users inside one configured allowed domain at a time
- Search and page through a bounded provider-backed result
- View safe account details without credentials, roles, or raw permissions
- Create an ordinary user with an initial password

Creating a user requires the current Veda administrator password and, when
enabled, an authenticator or unused backup code. Veda Mail hard-codes the
ordinary Stalwart `User` role and inherited permissions; the browser cannot
supply a Stalwart account ID, role, permission, group, alias, or directory ID.
The initial mailbox password is sent once to Stalwart over HTTPS and is never
returned, logged, or stored. A durable UUID idempotency record prevents a
double click or safe replay from provisioning the same intent twice. When an
administrator retries an identical request after losing its response, Veda
reports that the result was replayed: the password from the first attempt
remains authoritative and the newly re-entered password was not applied.

The selected domain must exist, be enabled in Stalwart, and appear in Veda
Mail's allowed-domain list. Creation is disabled when the domain or global
authentication configuration uses LDAP, SQL, OIDC, or another external
directory; create the identity in that source directory instead.

The current feature does not suspend, delete, reset, or change roles/quotas.
Those actions and all lifecycle operations for Standard IMAP + SMTP remain in
the provider's own administration surface. To revoke access, disable/reset the
provider mailbox or remove its domain from the allowed list. Restarting Veda
Mail signs out all members because member sessions are process-local.

See [mail-server setup](MAIL-SERVER-SETUP.md#stalwart-mailbox-user-management)
for least-privilege API-key permissions and rotation.

After provisioning, give the member the Veda Mail URL. The member signs in
using the full email address and initial mailbox password and should change it
through a provider-supported account workflow.

## Member two-factor authentication

Every provider receives the Veda-managed authenticator overlay. Members enroll
from their account settings and receive ten one-time backup codes. The TOTP
secret is encrypted under `/data`; it is not sent to Stalwart, Hostinger,
Zoho, or another provider.

This second factor protects only Veda Mail. It does not protect direct IMAP,
the provider's own webmail, or other mail clients. Provider-native MFA remains
recommended. See [member authenticator 2FA](MEMBER-2FA.md).

## Routine checks

Monthly:

- Review allowed domains and provider hostname restrictions.
- Test administrator and a dedicated member account.
- Confirm backups and perform periodic restore rehearsals.
- Review application and provider logs for repeated failures.
- Install supported security updates.
- Confirm the public source link matches the running modified version.
