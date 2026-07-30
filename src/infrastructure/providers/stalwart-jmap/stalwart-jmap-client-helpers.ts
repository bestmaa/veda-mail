import "server-only";

import type { StalwartConfig } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export const basicAuthorizationHeader = (config: StalwartConfig): string => {
  const encoded = Buffer.from(`${config.username}:${config.secret}`).toString(
    "base64",
  );
  return `Basic ${encoded}`;
};

export const stalwartHttpError = (response: Response): Error => {
  const retryAfter = response.headers.get("retry-after");
  const suffix = retryAfter ? ` Retry after ${retryAfter}s.` : "";
  return new Error(
    `Mail provider returned ${response.status}.${suffix}`.trim(),
  );
};
