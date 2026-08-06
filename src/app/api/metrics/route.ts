import { metricsAccess } from "@/server/observability/metrics-auth";
import {
  recordHttpResponse,
  renderPrometheusMetrics,
} from "@/server/observability/metrics";

export const runtime = "nodejs";

const response = (body: string, status: number, headers?: HeadersInit) => {
  recordHttpResponse(status);
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      ...headers,
    },
    status,
  });
};
export const GET = (request: Request) => {
  const access = metricsAccess(request);
  if (access === "disabled") return response("Not found.\n", 404);
  if (access === "unauthorized") {
    return response("Unauthorized.\n", 401, {
      "WWW-Authenticate": 'Bearer realm="veda-mail-metrics"',
    });
  }
  return response(renderPrometheusMetrics(), 200);
};
