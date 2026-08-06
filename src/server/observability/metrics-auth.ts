import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

const configuredToken = (): string | null => {
  const token = process.env["VEDA_MAIL_METRICS_TOKEN"]?.trim() ?? "";
  if (!token) return null;
  if (token.length < 24 || token.length > 256) {
    throw new Error("VEDA_MAIL_METRICS_TOKEN must contain 24 to 256 characters.");
  }
  return token;
};

const equal = (left: string, right: string): boolean => {
  const digest = (value: string) =>
    createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(left), digest(right));
};

export type MetricsAccess = "authorized" | "disabled" | "unauthorized";

export const metricsAccess = (request: Request): MetricsAccess => {
  const token = configuredToken();
  if (!token) return "disabled";
  const authorization = request.headers.get("authorization") ?? "";
  return equal(authorization, `Bearer ${token}`)
    ? "authorized"
    : "unauthorized";
};
