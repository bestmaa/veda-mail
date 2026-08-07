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

Registries intentionally remain process-memory-only: a restart revokes every
interactive session and erases member provider credentials. Do not use multiple
Veda Mail replicas until the roadmap's encrypted shared-session repository is
complete.

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

This option coordinates authentication throttling only. Other request limits,
provider sessions, delivery notices, send idempotency, attachment quarantine,
and mutable member repositories retain the documented single-replica boundary.
