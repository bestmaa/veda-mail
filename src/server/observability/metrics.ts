import "server-only";

import type { ProviderId } from "@/domain/shared/brand";

export type ProviderMetricOutcome = "error" | "success";

interface ProviderAccumulator {
  count: number;
  durationMs: number;
  errors: number;
  maximumMs: number;
}

export interface ProviderMetricSnapshot extends ProviderAccumulator {
  readonly averageMs: number;
  readonly operation: string;
  readonly providerId: string;
}

interface MetricsState {
  readonly httpResponses: Map<number, number>;
  readonly providers: Map<string, ProviderAccumulator>;
  readonly startedAt: number;
}

const metricsGlobal = globalThis as typeof globalThis & {
  __vedaMailMetrics?: MetricsState;
};

const createState = (): MetricsState => ({
  httpResponses: new Map(),
  providers: new Map(),
  startedAt: Date.now(),
});

const state = (): MetricsState =>
  (metricsGlobal.__vedaMailMetrics ??= createState());

const operationName = (value: PropertyKey): string => {
  const candidate = String(value);
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(candidate)
    ? candidate
    : "unknown";
};

export const recordHttpResponse = (status: number): void => {
  const statusClass = Number.isSafeInteger(status)
    ? Math.min(5, Math.max(1, Math.floor(status / 100)))
    : 5;
  const current = state().httpResponses.get(statusClass) ?? 0;
  state().httpResponses.set(statusClass, current + 1);
};

export const observeProviderOperation = (
  providerId: ProviderId,
  operation: PropertyKey,
  durationMs: number,
  outcome: ProviderMetricOutcome,
): void => {
  const name = operationName(operation);
  const key = `${providerId}:${name}`;
  const current = state().providers.get(key) ?? {
    count: 0,
    durationMs: 0,
    errors: 0,
    maximumMs: 0,
  };
  current.count += 1;
  current.durationMs += Math.max(0, durationMs);
  current.maximumMs = Math.max(current.maximumMs, durationMs);
  if (outcome === "error") current.errors += 1;
  state().providers.set(key, current);
};

export const observabilitySnapshot = () => ({
  httpResponses: [...state().httpResponses.entries()]
    .sort(([left], [right]) => left - right)
    .map(([statusClass, count]) => ({ count, statusClass })),
  providers: [...state().providers.entries()]
    .map(([key, value]): ProviderMetricSnapshot => {
      const separator = key.indexOf(":");
      return {
        ...value,
        averageMs: value.count ? value.durationMs / value.count : 0,
        operation: key.slice(separator + 1),
        providerId: key.slice(0, separator),
      };
    })
    .sort((left, right) =>
      `${left.providerId}:${left.operation}`.localeCompare(
        `${right.providerId}:${right.operation}`,
      ),
    ),
  startedAt: new Date(state().startedAt).toISOString(),
  uptimeSeconds: Math.max(0, (Date.now() - state().startedAt) / 1_000),
});

const metricLine = (
  name: string,
  labels: string,
  value: number,
): string => `${name}{${labels}} ${Number.isFinite(value) ? value : 0}`;

export const renderPrometheusMetrics = (): string => {
  const snapshot = observabilitySnapshot();
  const lines = [
    "# HELP veda_mail_uptime_seconds Process uptime in seconds.",
    "# TYPE veda_mail_uptime_seconds gauge",
    `veda_mail_uptime_seconds ${snapshot.uptimeSeconds}`,
    "# HELP veda_mail_http_responses_total API responses by status class.",
    "# TYPE veda_mail_http_responses_total counter",
    ...snapshot.httpResponses.map(({ count, statusClass }) =>
      metricLine(
        "veda_mail_http_responses_total",
        `status_class="${statusClass}xx"`,
        count,
      ),
    ),
    "# HELP veda_mail_provider_operations_total Provider operations by outcome.",
    "# TYPE veda_mail_provider_operations_total counter",
    "# HELP veda_mail_provider_duration_milliseconds_sum Provider operation latency sum.",
    "# TYPE veda_mail_provider_duration_milliseconds_sum counter",
    "# HELP veda_mail_provider_duration_milliseconds_max Provider operation lifetime maximum latency.",
    "# TYPE veda_mail_provider_duration_milliseconds_max gauge",
  ];
  for (const metric of snapshot.providers) {
    const labels = `provider="${metric.providerId}",operation="${metric.operation}"`;
    lines.push(
      metricLine(
        "veda_mail_provider_operations_total",
        `${labels},outcome="success"`,
        metric.count - metric.errors,
      ),
      metricLine(
        "veda_mail_provider_operations_total",
        `${labels},outcome="error"`,
        metric.errors,
      ),
      metricLine(
        "veda_mail_provider_duration_milliseconds_sum",
        labels,
        metric.durationMs,
      ),
      metricLine(
        "veda_mail_provider_duration_milliseconds_max",
        labels,
        metric.maximumMs,
      ),
    );
  }
  return `${lines.join("\n")}\n`;
};

export const resetObservabilityMetricsForTests = (): void => {
  metricsGlobal.__vedaMailMetrics = createState();
};
