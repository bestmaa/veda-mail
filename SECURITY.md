# Security policy

## Supported versions

Until the first stable release, only the latest tagged release is supported
with security fixes. Deploy tagged releases or pinned commits and keep backups.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting for
`https://github.com/bestmaa/veda-mail` when available. If that channel is
unavailable, contact the repository owner privately through their verified
GitHub profile and request a secure reporting channel. Do not include live
credentials in the first message.

Include:

- A concise description and affected version/commit
- Reproduction steps or a minimal proof of concept
- Expected and observed impact
- Relevant configuration with secrets removed
- Any suggested mitigation

Maintainers should acknowledge a complete report within seven days. Timelines
for validation, remediation, and disclosure depend on severity and complexity.
Please allow a reasonable remediation window before public disclosure.

## Security boundaries

- `/setup` is a one-time, rate-limited installation claim.
- `/admin` uses a distinct administrator account and cookie.
- `/` uses each member's provider credentials and a member-only cookie.
- Provider and member secrets remain server-side.
- Member credentials are held only in process memory and vanish on restart.
- Installation/provider state persists on `/data` and must be protected.

## Deployment responsibility

Operators must:

- Use HTTPS.
- Generate a strong setup token and protect the `/data` volume.
- Restrict provider hostnames.
- Keep proxy trust disabled unless forwarding headers are controlled.
- Run a single application replica until shared sessions and rate limits are
  implemented.
- Back up before upgrading.
- Keep the mail server, Docker host, reverse proxy, and dependencies patched.

See [deployment](docs/DEPLOYMENT.md) and
[backup and recovery](docs/BACKUP-AND-RECOVERY.md). The maintained
[threat model](docs/THREAT-MODEL.md) records trust boundaries, current
controls, residual risks, and security gates for planned features.

## Out of scope

- Social engineering or credential stuffing without a product vulnerability
- Vulnerabilities only in an unsupported or independently modified deployment
- Mail-provider vulnerabilities not caused by Veda Mail
- Missing email deliverability configuration
- Denial-of-service testing against public/community instances
