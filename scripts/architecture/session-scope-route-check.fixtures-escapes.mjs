const imports = `
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { readProtectedMailbox } from "@/server/mail/protected";
`;

const guardedDecoy = `
  const decoy = await getCurrentConnection();
  assertMailSessionScope(request, decoy);`;

export const ESCAPE_SESSION_SCOPE_ROUTE_FIXTURES = [
  {
    expected: ["DELETE", "GET", "PATCH", "POST"],
    name: "returned imported delegates fail despite a guarded decoy",
    source: `${imports}
import { unscopedMailHandler } from "./handler";
const nested = async (request: Request) => unscopedMailHandler(request);
export const GET = async (request: Request) => {${guardedDecoy}
  return unscopedMailHandler(request);
};
export const POST = async (request: Request) => {${guardedDecoy}
  const delegate = unscopedMailHandler;
  return delegate(request);
};
export const PATCH = async (request: Request) => {${guardedDecoy}
  return nested(request);
};
export const DELETE = async (request: Request) => {${guardedDecoy}
  return Promise.resolve().then(() => unscopedMailHandler(request));
};`,
  },
  {
    expected: [],
    name: "known request utilities are not unresolved handler delegates",
    source: `${imports}
import { assertSameOrigin } from "@/server/installation/request-origin";
import { assertRequestRateLimit } from "@/server/security/rate-limit";
import { readJsonBody } from "@/transport/http/read-json-body";
import { apiSuccess } from "@/transport/http/api-response";
const parse = (request: Request) => readJsonBody(request, 1024);
export const POST = async (request: Request) => {
  assertSameOrigin(request);
  assertRequestRateLimit(request, "safe", 1, 1, 1);
  const input = await parse(request);
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  return apiSuccess(input);
};`,
  },
  {
    expected: ["GET"],
    name: "a zero-argument current-connection wrapper fails closed",
    source: `${imports}
import { getMailService } from "@/server/mail/mail-service";
export const GET = async (request: Request) => {${guardedDecoy}
  const service = await getMailService();
  return service.listMessages();
};
export const POST = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  const service = await getMailService(connection);
  return service.listMessages();
};`,
  },
  {
    expected: ["GET"],
    name: "dynamic imports cannot hide a security primitive",
    source: `${imports}
export const GET = async (request: Request) => {${guardedDecoy}
  const sessions = await import("@/server/connections/connection-session");
  const real = await sessions.getCurrentConnection();
  return readProtectedMailbox(real);
};`,
  },
  {
    expected: ["GET"],
    name: "a namespace alias preserves authentication provenance",
    source: `${imports}
import * as sessions from "@/server/connections/connection-session";
export const GET = async (request: Request) => {${guardedDecoy}
  const alias = sessions;
  const real = await alias.getCurrentConnection();
  return readProtectedMailbox(real);
};
export const POST = async (request: Request) => {
  const alias = sessions;
  const connection = await alias.getCurrentConnection();
  assertMailSessionScope(request, connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET", "PATCH"],
    name: "local classes and object methods cannot hide authentication",
    source: `${imports}
class HiddenAuth {
  async run() { return getCurrentConnection(); }
}
export const GET = async (request: Request) => {${guardedDecoy}
  const real = await new HiddenAuth().run();
  return readProtectedMailbox(real);
};
export const PATCH = async (request: Request) => {${guardedDecoy}
  const auth = { async run() { return getCurrentConnection(); } };
  const real = await auth.run();
  return readProtectedMailbox(real);
};`,
  },
  {
    expected: ["GET", "POST"],
    name: "parameter and binding defaults cannot hide authentication",
    source: `${imports}
export const GET = async (
  request: Request,
  hidden = getCurrentConnection(),
) => {${guardedDecoy}
  return readProtectedMailbox(await hidden);
};
export const POST = async (request: Request) => {${guardedDecoy}
  const { real = getCurrentConnection() } = {};
  return readProtectedMailbox(await real);
};`,
  },
  {
    expected: ["GET", "POST"],
    name: "mutable direct and indirect HTTP exports fail closed",
    source: `${imports}
import { unscopedMailHandler } from "./handler";
export let GET = async (request: Request) => {${guardedDecoy}
  return new Response(null);
};
GET = unscopedMailHandler;
let handler = async (request: Request) => {${guardedDecoy}
  return new Response(null);
};
export { handler as POST };
handler = unscopedMailHandler;`,
  },
  {
    expected: ["PATCH", "PUT"],
    name: "top-level primitive assignments and functions are not immutable",
    source: `${imports}
import { unscopedMailHandler } from "./handler";
let hidden;
hidden = () => getCurrentConnection();
export const PATCH = async (request: Request) => {${guardedDecoy}
  const real = await hidden();
  return readProtectedMailbox(real);
};
export async function PUT(request: Request) {${guardedDecoy}
  return new Response(null);
}
PUT = unscopedMailHandler;`,
  },
];
