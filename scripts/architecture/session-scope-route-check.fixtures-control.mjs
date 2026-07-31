const imports = `
import { getCurrentConnection } from "@/server/connections/connection-session";
import {
  assertMailSessionScope,
  assertMailSessionScopeValue,
} from "@/server/connections/mail-session-scope";
import { readProtectedMailbox } from "@/server/mail/protected";
`;

export const CONTROL_SESSION_SCOPE_ROUTE_FIXTURES = [
  {
    expected: ["GET"],
    name: "a falsy conditional alias cannot erase successful authentication",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  const maybe = request.headers.has("x-mail") ? connection : null;
  if (!maybe) return readProtectedMailbox(connection);
  assertMailSessionScope(request, connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: [],
    name: "a direct alias preserves caught-null authentication provenance",
    source: `${imports}
export const DELETE = async (request: Request) => {
  const connection = await getCurrentConnection().catch(() => null);
  const alias = connection;
  if (!alias) return new Response(null);
  assertMailSessionScope(request, connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET", "POST"],
    name: "swallowed direct or helper guard failures retain their connection",
    source: `${imports}
const authorize = (request: Request, connection: unknown) =>
  assertMailSessionScope(request, connection);
export const GET = async (request: Request) => {
  let connection;
  try {
    connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
  } catch {
    return readProtectedMailbox(connection);
  }
  return new Response(null);
};
export const POST = async (request: Request) => {
  const connection = await getCurrentConnection();
  try {
    authorize(request, connection);
  } catch {
    return readProtectedMailbox(connection);
  }
  return new Response(null);
};`,
  },
  {
    expected: [],
    name: "a terminal error response may catch authentication or guard failure",
    source: `${imports}
export const GET = async (request: Request) => {
  try {
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    return readProtectedMailbox(connection);
  } catch {
    return new Response(null, { status: 409 });
  }
};`,
  },
  {
    expected: ["GET", "POST"],
    name: "break and continue make following guards unreachable",
    source: `${imports}
export const GET = async (request: Request) => {
  let connection;
  do {
    connection = await getCurrentConnection();
    break;
    assertMailSessionScope(request, connection);
  } while (false);
  return readProtectedMailbox(connection);
};
export const POST = async (request: Request) => {
  let connection;
  for (const value of [1]) {
    connection = await getCurrentConnection();
    continue;
    assertMailSessionScope(request, connection);
  }
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: [],
    name: "a guard before a loop protects callback work",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  for (const value of [1]) {
    await readProtectedMailbox(connection, value);
  }
  return new Response(null);
};`,
  },
  {
    expected: ["GET", "POST"],
    name: "loop iterations cannot establish or mutate authorization proof",
    source: `${imports}
import { unscopedMailHandler } from "./handler";
export const GET = async (request: Request) => {
  let authorize = assertMailSessionScope;
  let connection;
  for (const value of [1, 2]) {
    connection = await getCurrentConnection();
    authorize(request, connection);
    authorize = () => undefined;
  }
  return readProtectedMailbox(connection);
};
export const POST = async (request: Request) => {
  for (const value of []) {
    const decoy = await getCurrentConnection();
    assertMailSessionScope(request, decoy);
  }
  return unscopedMailHandler(request);
};`,
  },
];
