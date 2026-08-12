# Session security and shared login throttling

Veda Mail keeps provider credentials server-side and treats every session ID as
a bearer secret. Administrator and member cookies are `HttpOnly`, `Secure` in
production, host-scoped, and `SameSite=Lax`. State-changing API calls also need
a verifiable same-origin `Origin` or Fetch Metadata signal; ambiguous requests
fail closed.

## Lifetime and revocation

Both session kinds have two deadlines:

- 30 minutes without an authenticated request (idle expiry)
- 12 hours from sign-in regardless of activity (absolute expiry)

The server registry is authoritative. Clearing a cookie is not considered
logout until its registry entry is removed. Administrator **Security** lists
administrator and mailbox sessions; member **Account settings** lists sessions
for that HMAC-indexed mailbox owner. Either view can revoke one session. A
current-session revoke clears its cookie and returns to sign-in.

Browser responses contain only HMAC-derived management handles, coarse browser
and platform labels, and timestamps. They never expose raw admin nonces, member
connection IDs, client IPs, user-agent strings, provider credentials, or email
addresses. Session create/revoke/sign-out events enter the tamper-evident
security audit.

Without shared state configured, registries remain process-memory-only: a
restart revokes every interactive session and erases member provider
credentials. An optional Redis-compatible repository stores administrator and
member records as record-bound AES-256-GCM ciphertext with opaque HMAC record
and owner indexes. Idle touch, config replacement, revocation, expiry-index
updates, and the 10,000-record safety cap use atomic Redis operations. A
configured invalid, unavailable, key-mismatched, or tampered backend fails
session access closed.

Configure the shared repository on every application process with the exact
same secret-managed values:

```dotenv
VEDA_MAIL_STATE_REDIS_URL=rediss://user:password@redis.example.com:6379
VEDA_MAIL_STATE_REDIS_PREFIX=veda-mail:state:v1
VEDA_MAIL_JOB_KEY=<the same base64-encoded 32-byte key on every replica>
```

This shared-state repository also carries owner-bound encrypted scheduled-send
and snooze books. It never stores their provider credentials or message content
as plaintext; queue migration and backup guidance is in the deployment runbook.
Immediate-send fingerprints, random claims, and bounded canonical receipts are
kept in separate connection-bound ciphertext so retries coalesce across replicas.
Partial/uncertain delivery notices use another connection-bound ciphertext
bucket; global budgets, dismissal, expiry, and revocation cleanup are locked
across replicas.

Use a dedicated least-privilege Redis database, TLS across untrusted networks,
network allowlisting, authentication, persistence, backups, memory limits with
a no-eviction policy, and availability monitoring. Redis never receives raw
session IDs, owner identities, email addresses, or provider credentials.
Rotating `VEDA_MAIL_JOB_KEY` intentionally invalidates every shared session.
Disabling the backend does not migrate active ciphertext into process memory.
The readiness endpoint probes a configured repository and degrades while it is
unavailable, without exposing its URL or Redis error text.

This advances the multi-replica roadmap item. Do not enable multiple writable
Veda Mail replicas yet: attachment quarantine, non-login limits, and mutable
`/data` repositories still need their documented shared or single-writer
replacements.

## Optional Redis login limiter

Single-replica deployments need no additional service. To coordinate admin and
member login windows across processes or edge replicas, configure:

```dotenv
VEDA_MAIL_RATE_LIMIT_REDIS_URL=rediss://user:password@redis.example.com:6379
VEDA_MAIL_RATE_LIMIT_REDIS_PREFIX=veda-mail:rate-limit:v1
```

Use a dedicated least-privilege Redis database, TLS across untrusted networks,
network allowlisting, authentication, persistence/monitoring appropriate to the
deployment, and a secret manager for the URL. The application uses one atomic
Lua fixed-window operation per global/source/subject key. Keys contain only an
HKDF/HMAC digest derived from `VEDA_MAIL_JOB_KEY`; raw accounts and addresses
never leave the process. If a configured Redis backend is invalid or
unavailable, login returns a recoverable 503 instead of silently bypassing the
shared control. Existing process-local limits remain in front of Redis.

This limiter option coordinates authentication throttling only and is separate
from `VEDA_MAIL_STATE_REDIS_URL`. Operators may use one appropriately isolated
Redis service with distinct prefixes/credentials, but should grant only the
commands each database needs. Other request limits, attachment quarantine, and
mutable member repositories retain the documented single-replica boundary.
