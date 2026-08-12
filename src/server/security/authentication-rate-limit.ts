import "server-only";

import { consumeDistributedRateLimit } from "@/server/security/distributed-rate-limit";
import {
  assertLocalRequestRateLimit,
  assertLocalSubjectRateLimit,
  rateLimitSourceFor,
} from "@/server/security/rate-limit";

export const assertAuthenticationRequestRateLimit = async (
  request: Request,
  scope: string,
  globalLimit: number,
  trustedSourceLimit: number,
  durationMs: number,
): Promise<void> => {
  assertLocalRequestRateLimit(
    request, scope, globalLimit, trustedSourceLimit, durationMs,
  );
  await consumeDistributedRateLimit({
    dimension: "global", durationMs, limit: globalLimit,
    scope, subject: "all",
  });
  const source = rateLimitSourceFor(request);
  if (source) {
    await consumeDistributedRateLimit({
      dimension: "source", durationMs, limit: trustedSourceLimit,
      scope, subject: source,
    });
  }
};

export const assertAuthenticationSubjectRateLimit = async (
  scope: string,
  subject: string,
  limit: number,
  durationMs: number,
): Promise<void> => {
  assertLocalSubjectRateLimit(scope, subject, limit, durationMs);
  await consumeDistributedRateLimit({
    dimension: "subject", durationMs, limit, scope,
    subject: subject.trim().toLowerCase(),
  });
};
