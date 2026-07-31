const imports = `
import { getCurrentConnection } from "@/server/connections/connection-session";
import {
  assertMailSessionScope,
  assertMailSessionScopeValue,
} from "@/server/connections/mail-session-scope";
import { readProtectedMailbox } from "@/server/mail/protected";
`;

export const RESOLUTION_SESSION_SCOPE_ROUTE_FIXTURES = [
  {
    expected: ["GET", "PATCH", "POST"],
    name: "mixed or discarded request provenance is not a scope value",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  const supplied = request.headers.has("x") ? request.url : "constant";
  assertMailSessionScopeValue(supplied, connection);
  return readProtectedMailbox(connection);
};
export const POST = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScopeValue(request.url && "constant", connection);
  return readProtectedMailbox(connection);
};
export const PATCH = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScopeValue((request.url, "constant"), connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    name: "a local no-op cannot shadow the imported guard",
    source: `${imports}
export const GET = async (request: Request) => {
  const assertMailSessionScope = () => undefined;
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    name: "a destructured HTTP export fails closed",
    source: `${imports}
const handlers = {
  GET: async () => {
    const connection = await getCurrentConnection();
    return readProtectedMailbox(connection);
  },
};
export const { GET } = handlers;`,
  },
  {
    expected: ["*"],
    name: "an export star fails closed",
    source: `export * from "./handler";`,
  },
  {
    expected: ["POST"],
    name: "an inline imported handler wrapper fails closed",
    source: `
import { wrapped } from "./handler";
export const POST = async (request: Request) => wrapped(request);`,
  },
  {
    expected: ["GET"],
    name: "protected work in a local callable is checked before a later guard",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  const work = () => readProtectedMailbox(connection);
  await work();
  assertMailSessionScope(request, connection);
  return new Response(null);
};`,
  },
  {
    expected: ["GET"],
    name: "authentication inside an IIFE reaches root validation",
    source: `${imports}
export const GET = async () => {
  await (async () => {
    await getCurrentConnection();
  })();
  return new Response(null);
};`,
  },
  {
    expected: ["GET"],
    name: "authentication and work inside a catch callback are inspected",
    source: `${imports}
export const GET = async () => {
  await Promise.reject().catch(async () => {
    const connection = await getCurrentConnection();
    return readProtectedMailbox(connection);
  });
  return new Response(null);
};`,
  },
  {
    expected: ["GET"],
    name: "a callback guard cannot authorize a caller path",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  [1].map(() => assertMailSessionScope(request, connection));
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: [],
    name: "a callback may use an already guarded captured connection",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  await Promise.all([1].map(() => readProtectedMailbox(connection)));
  return new Response(null);
};`,
  },
  {
    expected: ["GET", "PATCH"],
    name: "decoy or dynamic fields cannot authorize the real connection",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  const holder = { actual: connection, decoy: { id: "decoy" } };
  assertMailSessionScope(request, holder.decoy);
  return readProtectedMailbox(holder.actual);
};
export const PATCH = async (request: Request) => {
  const connection = await getCurrentConnection();
  const holder = { actual: connection, decoy: { id: "decoy" } };
  const selected = holder[new URL(request.url).searchParams.get("field")!];
  assertMailSessionScope(request, selected);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: [],
    name: "guarding the exact object field preserves its connection identity",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  const holder = { actual: connection, decoy: { id: "decoy" } };
  assertMailSessionScope(request, holder.actual);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET", "POST"],
    name: "local and object aliases cannot hide authentication",
    source: `${imports}
export const GET = async () => {
  const authenticate = getCurrentConnection;
  const connection = await authenticate();
  return readProtectedMailbox(connection);
};
export const POST = async () => {
  const auth = { run: getCurrentConnection };
  const connection = await auth.run();
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: [],
    name: "indirect authentication and guard aliases remain traceable",
    source: `${imports}
export const GET = async (request: Request) => {
  const auth = { run: getCurrentConnection };
  const authorize = { run: assertMailSessionScope };
  const connection = await auth.run();
  authorize.run(request, connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    name: "separate helper authentication calls need separate guards",
    source: `${imports}
const authenticate = async () => getCurrentConnection();
export const GET = async (request: Request) => {
  const first = await authenticate();
  assertMailSessionScope(request, first);
  const second = await authenticate();
  return readProtectedMailbox(second);
};`,
  },
];
