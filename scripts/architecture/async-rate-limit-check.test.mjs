import assert from "node:assert/strict";

import { unawaitedRateLimitCalls } from "./async-rate-limit-check.mjs";

const imports = `import {
  assertRequestRateLimit as requestLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";`;

assert.deepEqual(unawaitedRateLimitCalls("safe.ts", `${imports}
export const GET = async (request: Request) => {
  await requestLimit(request, "read", 10, 2, 1000);
  await assertSubjectRateLimit("read", "member", 2, 1000);
};`), []);

assert.deepEqual(unawaitedRateLimitCalls("unsafe.ts", `${imports}
export const GET = async (request: Request) => {
  requestLimit(request, "read", 10, 2, 1000);
  void assertSubjectRateLimit("read", "member", 2, 1000);
};`), [6, 7]);
