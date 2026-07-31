const imports = `
import { getCurrentConnection } from "@/server/connections/connection-session";
import {
  assertMailSessionScope,
  assertMailSessionScopeValue,
} from "@/server/connections/mail-session-scope";
import { readProtectedMailbox } from "@/server/mail/protected";
import {
  serverScopeIgnoringInput,
  unscopedByUrl,
  unscopedMailHandler,
  unscopedSnapshot,
} from "./untrusted-handler";
`;

const guardedDecoy = `
  const decoy = await getCurrentConnection();
  assertMailSessionScope(request, decoy);`;

export const EFFECT_SESSION_SCOPE_ROUTE_FIXTURES = [
  {
    expected: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
    name: "unreviewed imported calls cannot consume or return request authority",
    source: `${imports}
const staged = async (request: Request) => {
  const result = await unscopedByUrl(request.url);
  return result;
};
export const GET = async (request: Request) => {${guardedDecoy}
  const result = await unscopedMailHandler(request);
  return result;
};
export const POST = async (request: Request) => {${guardedDecoy}
  await unscopedMailHandler(request);
  return new Response(null);
};
export const PUT = async (request: Request) => {${guardedDecoy}
  return unscopedByUrl(request.url);
};
export const PATCH = async (request: Request) => {${guardedDecoy}
  return unscopedSnapshot();
};
export const DELETE = async (request: Request) => {${guardedDecoy}
  return unscopedMailHandler({ request });
};
export const HEAD = async (request: Request) => {${guardedDecoy}
  return unscopedMailHandler(request.clone());
};
export const OPTIONS = async (request: Request) => {${guardedDecoy}
  return staged(request);
};`,
  },
  {
    expected: ["GET"],
    name: "an unreviewed transform cannot manufacture value-scope provenance",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  const claimedScope = serverScopeIgnoringInput(request.url);
  assertMailSessionScopeValue(claimedScope, connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET", "POST", "PUT"],
    name: "discarding an unreviewed imported call result is still unsafe",
    source: `${imports}
import { purgeAllMail, purgeMailboxById } from "./untrusted-handler";
export const GET = async (request: Request) => {${guardedDecoy}
  await purgeAllMail();
  return new Response(null, { status: 204 });
};
export const POST = async (request: Request) => {${guardedDecoy}
  await purgeMailboxById("victim");
  return new Response(null, { status: 204 });
};
export const PUT = async (request: Request) => {${guardedDecoy}
  await unscopedByUrl(request.url);
  return new Response(null, { status: 204 });
};`,
  },
  {
    expected: ["GET", "POST"],
    name: "finally executes on the exceptional edge of a session guard",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  try {
    assertMailSessionScope(request, connection);
  } finally {
    return readProtectedMailbox(connection);
  }
};
export const POST = async (request: Request) => {
  const connection = await getCurrentConnection();
  try {
    assertMailSessionScope(request, connection);
  } finally {
    readProtectedMailbox(connection);
  }
  return new Response(null);
};`,
  },
  {
    expected: [],
    name: "a non-sensitive finally cleanup preserves a successful guard",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  try {
    assertMailSessionScope(request, connection);
    return readProtectedMailbox(connection);
  } finally {
    void 0;
  }
};`,
  },
  {
    expected: ["GET", "POST"],
    name: "a conditional decoy is not a must-alias for the real connection",
    source: `${imports}
const select = (request: Request, connection: unknown) =>
  request.headers.has("x-decoy") ? { id: "attacker-known-id" } : connection;
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  const selected = request.headers.has("x-decoy")
    ? { id: "attacker-known-id" }
    : connection;
  assertMailSessionScope(request, selected);
  return readProtectedMailbox(connection);
};
export const POST = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, select(request, connection));
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: [],
    name: "identical conditional branches retain must-alias identity",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  const selected = request.headers.has("x-choice")
    ? connection
    : connection;
  assertMailSessionScope(request, selected);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET", "POST"],
    name: "opaque connection properties are not must-aliases",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, (connection as any).config);
  return readProtectedMailbox(connection);
};
export const POST = async (request: Request) => {
  const connection = await getCurrentConnection();
  (connection as any).decoy = { id: "attacker-known-id" };
  assertMailSessionScope(request, (connection as any).decoy);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: [],
    name: "a statically known object field retains connection identity",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  const holder = { connection };
  assertMailSessionScope(request, holder.connection);
  return readProtectedMailbox(connection);
};`,
  },
];
