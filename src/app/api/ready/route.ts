import { recordHttpResponse } from "@/server/observability/metrics";
import { readinessSnapshot } from "@/server/observability/readiness";

export const runtime = "nodejs";

export const GET = async () => {
  const snapshot = await readinessSnapshot();
  const status = snapshot.status === "ready" ? 200 : 503;
  recordHttpResponse(status);
  return Response.json(
    { data: snapshot },
    { headers: { "Cache-Control": "private, no-store" }, status },
  );
};
