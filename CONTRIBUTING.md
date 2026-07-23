# Contributing

Thank you for helping improve Veda Mail.

## Before starting

- Search existing issues and pull requests.
- Use a security report, not a public issue, for vulnerabilities.
- Discuss large product, schema, provider, or persistence changes in an issue.
- Keep changes focused; unrelated cleanup belongs in another pull request.

By contributing, you agree that your contribution is licensed under
GNU AGPL-3.0-or-later and that you have the right to submit it.

## Development

Requirements:

- Node.js 24+
- npm 11+
- Git

```bash
git clone https://github.com/bestmaa/veda-mail.git
cd veda-mail
npm ci
cp .env.example .env.local
npm run setup:token
npm run dev
```

Never commit `.env`, runtime `/data`, real mailbox content, credentials, API
tokens, or private organization logos.

## Architecture rules

- UI views receive data and callbacks through props only.
- React state/effects and network calls belong in custom hooks.
- Connectors translate hook state into view props.
- Provider-specific code stays behind `MailGateway` and `ProviderModule`.
- Persistent profile configuration never contains member passwords.
- Files under `src`, `tests`, and `scripts` stay at or below 250 lines.
- Preserve strict TypeScript and avoid `any`.

Read [architecture](docs/ARCHITECTURE.md) and
[adding a provider](docs/ADDING-A-PROVIDER.md).

## Quality gates

Before opening a pull request:

```bash
npm run check
npm run build
npm audit --audit-level=high
```

Add tests for behavior changes. Include failure, authorization, and validation
cases for any boundary or persistent-state work.

## Pull requests

Describe:

- What changed and why
- Security and migration impact
- Tests performed
- Screenshots for intentional visual changes
- Documentation or upgrade steps

Do not include generated `.next`, coverage, runtime data, or dependency folders.
Maintainers may request smaller commits or follow-up tests before merging.

## Community

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be precise, kind, and patient
with people running different mail servers and deployment platforms.
