import "server-only";

import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import { probeClamAv } from "@/server/observability/clamav-probe";
import { probeDistributedRateLimit } from
  "@/server/security/distributed-rate-limit";
import { probeSharedStateRedis } from
  "@/server/shared-state/shared-state-redis";

export interface ReadinessCheck {
  readonly name: "data" | "rate-limit-store" | "scanner" | "session-store";
  readonly status: "failed" | "ok";
}

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const readinessSnapshot = async (
  dependencies: {
    readonly checkData?: () => Promise<void>;
    readonly checkRateLimitStore?: () => Promise<void>;
    readonly checkScanner?: () => Promise<void>;
    readonly checkSessionStore?: () => Promise<void>;
  } = {},
) => {
  const startedAt = performance.now();
  const results = await Promise.allSettled([
    (dependencies.checkData ??
      (() =>
        access(
          dataDirectory(),
          constants.R_OK | constants.W_OK | constants.X_OK,
        )))(),
    (dependencies.checkScanner ?? probeClamAv)(),
    (dependencies.checkSessionStore ?? probeSharedStateRedis)(),
    (dependencies.checkRateLimitStore ?? probeDistributedRateLimit)(),
  ]);
  const checks: readonly ReadinessCheck[] = [
    { name: "data", status: results[0]?.status === "fulfilled" ? "ok" : "failed" },
    {
      name: "scanner",
      status: results[1]?.status === "fulfilled" ? "ok" : "failed",
    },
    {
      name: "session-store",
      status: results[2]?.status === "fulfilled" ? "ok" : "failed",
    },
    {
      name: "rate-limit-store",
      status: results[3]?.status === "fulfilled" ? "ok" : "failed",
    },
  ];
  const ready = checks.every((check) => check.status === "ok");
  return {
    checks,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    service: "veda-mail",
    status: ready ? ("ready" as const) : ("degraded" as const),
    timestamp: new Date().toISOString(),
  };
};
