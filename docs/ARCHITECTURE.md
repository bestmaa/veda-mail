# Architecture

Veda Mail uses ports and adapters with an explicit presentation boundary.
Dependencies point inward and provider details stop at the gateway.

## Layers

| Layer | Responsibility | May depend on |
| --- | --- | --- |
| `domain` | Branded IDs and normalized mail/provider models | Domain only |
| `application` | Mail use cases and provider contracts | Domain |
| `infrastructure` | Mock and Stalwart provider adapters | Application, domain |
| `server` | Admin auth, profiles, member sessions, gateways | Inner layers |
| `transport` | HTTP envelopes, schemas, browser client | Domain |
| `presentation/hooks` | Browser state, effects, commands | Transport |
| `presentation/connectors` | Hooks translated into view props | Hooks, UI types |
| `presentation/ui` | Pure rendering and event forwarding | View props only |
| `app` | Next pages and route-handler composition | Server adapters |

## Presentation flow

1. A pure view invokes a callback received through props.
2. A connector supplied the callback from a custom hook.
3. The hook calls a same-origin `/api/v1` route.
4. The route validates input and invokes the application layer.
5. A `MailGateway` talks to the configured provider.
6. Provider DTOs are normalized before leaving infrastructure.

Views do not own state, effects, fetching, or provider knowledge.

## Installation and authentication boundaries

Setup, administrator, and member trust boundaries are separate:

```text
/setup -> setup token  -> one atomic installation record
/admin -> admin cookie -> admin API -> atomic installation updates
/      -> member cookie -> mail API -> member-scoped provider gateway
```

On a fresh volume, the setup token authorizes one installation claim but is
never persisted. Setup persists a scrypt administrator hash, random 48-byte
session secret, auth version, branding, public repository link, and the
mail-provider profile in `${VEDA_MAIL_DATA_DIR}/installation.json`. The
normalized WebP logo uses a content-addressed filename under
`${VEDA_MAIL_DATA_DIR}/branding/`.

Setup also persists the selected provider, server-side settings, display name,
and allowed domains in that same atomic record. A cross-process file lock and
create-only final commit ensure concurrent setup attempts cannot replace an
existing installation. Once installation state is complete, `/setup` is
locked independently of the environment token.

A member supplies email and password. The selected `ProviderModule` combines
those credentials with the service profile, tests the connection, and creates
an opaque process-local session. Passwords are never written to the profile
file or returned to the browser.

An admin cookie cannot read mail. A member cookie cannot change organization
or provider settings. Neither browser receives the administrator hash, signing
secret, provider credentials, or another member's mailbox credentials.

Changing the administrator account requires the current password, increments
the persisted auth version, invalidates older administrator tokens, and issues
the current administrator a replacement token.

## Provider boundary

`ProviderModule` has three responsibilities:

- Publish a manifest with `service` and `member` field scopes
- Parse persistent service configuration
- Combine service settings with member credentials

It then creates a normalized `MailGateway`. This keeps login and admin routes
free of Stalwart-specific field names.

The deterministic demo provider is registered only in development and test.
Production registries contain deployable providers only.

## Enforced invariants

- Source, test, script, and stylesheet files stay at or below 250 lines.
- UI files cannot use React state/effect hooks, fetch, or outer adapters.
- Domain and application layers cannot import outer layers.
- Provider implementation files are `server-only`.
- TypeScript uses strict optional properties, checked indexes, and unknown-safe
  catches.

Run:

```bash
npm run check:architecture
npm run check:lines
```

## Runtime model

- Installation, branding, and the service profile are durable on `/data`.
- Member connections and gateway credentials are memory-only for 12 hours.
- Restarting the process intentionally signs every member out.
- A multi-replica deployment needs a shared encrypted session repository and
  coordinated rate limiter behind the existing server boundary.

The browser never talks directly to a provider. Cookies are opaque, HttpOnly,
SameSite=Lax, and Secure in production. Stalwart provider origins use HTTPS,
a mandatory production hostname allowlist, DNS resolution checks, and
private-address rejection. The same policy is checked when configuration is
saved and before provider requests.
Rate-limit window keys contain keyed hashes of account, verified-session, or
trusted-source identifiers rather than their raw values.
