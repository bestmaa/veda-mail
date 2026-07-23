import { apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = () =>
  apiSuccess({
    service: "veda-mail",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
