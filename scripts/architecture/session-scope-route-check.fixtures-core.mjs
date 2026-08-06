const imports = `
import { getCurrentConnection } from "@/server/connections/connection-session";
import {
  assertMailSessionScope,
  assertMailSessionScopeValue,
} from "@/server/connections/mail-session-scope";
import { readProtectedMailbox } from "@/server/mail/protected";
`;

export const CORE_SESSION_SCOPE_ROUTE_FIXTURES = [
  {
    expected: ["GET"],
    name: "an import without an executed guard fails",
    source: `${imports}
export const GET = async () => {
  const connection = await getCurrentConnection();
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    name: "successful authentication requires a guard even without data use",
    source: `${imports}
export const GET = async () => {
  await getCurrentConnection();
  return new Response(null);
};`,
  },
  {
    expected: [],
    name: "an unauthenticated early path does not erase a guarded auth path",
    source: `${imports}
export const GET = async (request: Request) => {
  if (!request.headers.has("x-use-mail")) return new Response(null);
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: [],
    name: "a caught unauthenticated result needs no scope guard",
    source: `${imports}
export const DELETE = async (request: Request) => {
  const connection = await getCurrentConnection().catch(() => null);
  if (connection) {
    assertMailSessionScope(request, connection);
    await readProtectedMailbox(connection);
  }
  return new Response(null);
};`,
  },
  {
    expected: ["PATCH"],
    name: "each exported handler is checked independently",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  return readProtectedMailbox(connection);
};
export const PATCH = async () => {
  const connection = await getCurrentConnection();
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: [],
    name: "transitive authentication and authorization helpers pass",
    source: `${imports}
const authenticate = async () => getCurrentConnection();
const authorize = (request: Request, connection: unknown) =>
  assertMailSessionScope(request, connection);
const context = async (request: Request) => {
  const connection = await authenticate();
  authorize(request, connection);
  return connection;
};
export const POST = async (request: Request) =>
  readProtectedMailbox(await context(request));`,
  },
  {
    expected: ["DELETE"],
    name: "an unused guarded helper does not satisfy a handler",
    source: `${imports}
const unused = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
};
export const DELETE = async () => {
  const connection = await getCurrentConnection();
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: [],
    name: "aliased and namespace imports are resolved",
    source: `
import {
  getCurrentConnection as currentConnection
} from "@/server/connections/connection-session";
import * as scope from "@/server/connections/mail-session-scope";
import { readProtectedMailbox } from "@/server/mail/protected";
const authorize = async (request: Request) => {
  const connection = await currentConnection();
  const sameConnection = connection;
  scope.assertMailSessionScope(request, sameConnection);
  return readProtectedMailbox(connection);
};
export { authorize as PUT };`,
  },
  {
    expected: ["GET"],
    name: "a dead guard fails",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  if (false) assertMailSessionScope(request, connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    name: "a conditional guard fails when an unguarded path reaches work",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  if (request.headers.has("x-optional")) {
    assertMailSessionScope(request, connection);
  }
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["POST"],
    name: "a guard after protected work fails",
    source: `${imports}
export const POST = async (request: Request) => {
  const connection = await getCurrentConnection();
  await readProtectedMailbox(connection);
  assertMailSessionScope(request, connection);
};`,
  },
  {
    expected: ["GET"],
    name: "a guard for an unrelated connection fails",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, { id: "unrelated" });
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    name: "a guard using an unrelated request fails",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(new Request("https://example.test"), connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    name: "a constant query scope is not request-derived",
    source: `${imports}
export const GET = async () => {
  const connection = await getCurrentConnection();
  assertMailSessionScopeValue("constant", connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: [],
    name: "both request-derived guard branches pass",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  const supplied = new URL(request.url).searchParams.get("scope");
  if (supplied === null) {
    assertMailSessionScope(request, connection);
  } else {
    assertMailSessionScopeValue(supplied, connection);
  }
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    name: "an authenticated early-return path still requires a guard",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  if (!request.headers.has("x-use-mail")) return new Response(null);
  assertMailSessionScope(request, connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    name: "a wrapped exported handler fails closed",
    source: `${imports}
const actual = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  return readProtectedMailbox(connection);
};
const wrap = (handler: unknown) => handler;
export const GET = wrap(actual);`,
  },
  {
    expected: ["POST"],
    name: "a re-exported handler fails closed",
    source: `export { handler as POST } from "./handler";`,
  },
  {
    expected: [],
    name: "reviewed security audit helpers preserve a guarded connection",
    source: `${imports}
import { appendSecurityAudit, memberAuditActor } from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
export const POST = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  const actor = memberAuditActor(connection);
  const audit = securityAuditOperation({ action: "messages.destroyed", actor });
  await audit.attempt();
  await appendSecurityAudit({ action: "messages.destroyed", actor });
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["POST"],
    name: "security audit helpers cannot consume an unguarded connection",
    source: `${imports}
import { memberAuditActor } from "@/server/security-audit/security-audit";
export const POST = async (request: Request) => {
  const connection = await getCurrentConnection();
  const actor = memberAuditActor(connection);
  assertMailSessionScope(request, connection);
  return actor;
};`,
  },
];
