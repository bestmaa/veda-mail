import "server-only";

import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import { probeClamAv } from "@/server/observability/clamav-probe";

export interface ReadinessCheck {
  readonly name: "data" | "scanner";
  readonly status: "failed" | "ok";
}

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const readinessSnapshot = async (
  dependencies: {
    readonly checkData?: () => Promise<void>;
    readonly checkScanner?: () => Promise<void>;
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
  ]);
  const checks: readonly ReadinessCheck[] = [
    { name: "data", status: results[0]?.status === "fulfilled" ? "ok" : "failed" },
    {
      name: "scanner",
      status: results[1]?.status === "fulfilled" ? "ok" : "failed",
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
