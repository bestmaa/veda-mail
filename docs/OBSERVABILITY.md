# Observability

Veda Mail exposes low-cardinality, privacy-bounded operational signals for
self-hosted deployments. Logs and metrics never use mailbox, message, draft,
recipient, attachment, connection, or session identifiers as fields or labels.

## Request correlation

Every `/api/*` request receives an `x-request-id`. A caller-supplied identifier
is retained only when it contains 16 to 64 ASCII letters, digits, underscores,
or hyphens; otherwise Veda Mail creates a UUID. The same value is forwarded to
the route and returned on the response. Configure the reverse proxy to preserve
this header and include it in its access log. Never derive it from an email
address or another user identifier.

Unhandled request failures use this identifier when a request context is
available. Provider operation failures also carry it for
interactive requests. Background jobs have no request identifier and are
correlated by their bounded event name instead.

## Structured redacted logs

Server events are one-line JSON objects written to stdout/stderr. The stable
fields are `timestamp`, `level`, `service`, and `event`. Optional fields are
restricted to bounded operational values such as `requestId`, `providerId`,
`operation`, `outcome`, `durationMs`, `statusCode`, and `count`. Raw exceptions,
provider payloads, credentials, hosts, URLs with query strings, message data,
and arbitrary caller metadata are not serialized. `errorType` contains only a
bounded error class name.

Forward stdout/stderr to the deployment log collector. Treat the log store as
sensitive operational data, restrict it to administrators, encrypt it at rest,
and set an explicit retention period. Dynamic route segments are replaced with
`:id`, so message, attachment, account, and similar identifiers do not enter the
log store. A 14- to 30-day retention is a reasonable
starting point for a small installation.

## Liveness and readiness

- `GET /api/health` is the process liveness endpoint. It does not contact a mail
  provider or ClamAV and is appropriate for container restart decisions.
- `GET /api/ready` verifies that the configured data directory is readable and
  writable and that the private ClamAV service returns its exact `PONG` verdict.
  It returns HTTP 200 with `ready`, or HTTP 503 with `degraded`. The response
  names only the `data` and `scanner` checks and never exposes dependency errors,
  paths, or hosts.

Use readiness to remove an instance from load balancing. Do not restart an
otherwise live instance merely because ClamAV is loading fresh signatures.

## Prometheus metrics

Set a random 24- to 256-character secret in the deployment secret manager:

```dotenv
VEDA_MAIL_METRICS_TOKEN=replace-with-openssl-rand-hex-32
```

When the variable is empty, `GET /api/metrics` returns 404. When configured, a
scraper must send `Authorization: Bearer <token>`. The endpoint is non-cacheable
and must not be published through a browser-facing unauthenticated route.

```yaml
scrape_configs:
  - job_name: veda-mail
    scheme: https
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials_file: /run/secrets/veda-mail-metrics-token
    static_configs:
      - targets: [webmail.example.com]
```

Metrics are process-local. Scrape every replica and aggregate with `sum` or
`max` as appropriate. Restarting a replica resets its counters.

## Provider dashboard

Create one Grafana dashboard with these panels:

1. Provider operation rate:
   `sum by (provider, operation) (rate(veda_mail_provider_operations_total[5m]))`
2. Provider error ratio:
   `sum by (provider) (rate(veda_mail_provider_operations_total{outcome="error"}[5m])) / sum by (provider) (rate(veda_mail_provider_operations_total[5m]))`
3. Average provider latency:
   `sum by (provider, operation) (rate(veda_mail_provider_duration_milliseconds_sum[5m])) / sum by (provider, operation) (rate(veda_mail_provider_operations_total[5m]))`
4. Lifetime maximum latency per active replica:
   `max by (provider, operation) (veda_mail_provider_duration_milliseconds_max)`
5. HTTP 5xx rate:
   `sum(rate(veda_mail_http_responses_total{status_class="5xx"}[5m]))`
6. Instance uptime: `veda_mail_uptime_seconds`.

Provider and operation labels come from the compiled provider registry and
gateway contract. Do not add account, domain, mailbox, recipient, or request ID
labels; those create privacy leaks and unbounded cardinality.

## Alerting guidance

Tune thresholds to normal traffic and require a sustained window:

- page when `/api/health` fails for two minutes;
- remove from load balancing when `/api/ready` returns 503 for three checks;
- warn when a provider's error ratio exceeds 5% for ten minutes and page above
  20% for five minutes, provided the operation rate is non-zero;
- warn when average provider latency exceeds 2 seconds for ten minutes;
- page when HTTP 5xx responses continue for five minutes;
- warn when any replica restarts repeatedly or its uptime resets unexpectedly;
- alert separately on ClamAV container health and signature-update failures.

Do not put metric tokens, provider credentials, email addresses, message text,
or raw exception payloads in alert annotations. Link alerts to this runbook and
search structured logs by the returned `x-request-id` when investigating an
interactive failure.
