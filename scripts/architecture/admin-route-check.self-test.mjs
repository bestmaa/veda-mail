import assert from "node:assert/strict";

import { adminRouteHandlerViolations } from "./admin-route-check.mjs";

const checked = `
import { assertAdminAccess } from "@/server/auth/admin-session";
import { assertSameOrigin } from "@/server/installation/request-origin";
const guard = async () => { await assertAdminAccess(); };
export const GET = async () => { await guard(); return new Response(); };
export const POST = async (request) => {
  assertSameOrigin(request);
  await guard();
  return new Response();
};`;

const missing = `
export const GET = async () => new Response();
export const PUT = async () => new Response();`;

export const verifyAdminRouteChecker = () => {
  assert.deepEqual(adminRouteHandlerViolations("checked.ts", checked), []);
  assert.deepEqual(adminRouteHandlerViolations("missing.ts", missing), [
    "GET:admin-access",
    "PUT:admin-access",
    "PUT:same-origin",
  ]);
  assert.deepEqual(
    adminRouteHandlerViolations(
      "login.ts",
      `
      import { assertSameOrigin } from "@/server/installation/request-origin";
      export const POST = (request) => {
        assertSameOrigin(request);
        return new Response();
      };`,
      new Set(["POST"]),
    ),
    [],
  );
};
