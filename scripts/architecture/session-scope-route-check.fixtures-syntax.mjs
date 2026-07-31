const imports = `
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { readProtectedMailbox } from "@/server/mail/protected";
`;

const guardedDecoy = `
  const decoy = await getCurrentConnection();
  assertMailSessionScope(request, decoy);`;

export const SYNTAX_SESSION_SCOPE_ROUTE_FIXTURES = [
  {
    expected: ["GET"],
    name: "unreviewed imported constructors are effectful calls",
    source: `${imports}
import { UnscopedWorker } from "./untrusted-handler";
export const GET = async (request: Request) => {${guardedDecoy}
  new UnscopedWorker();
  return new Response(null, { status: 204 });
};`,
  },
  {
    expected: ["GET", "PATCH", "POST"],
    name: "class aliases and static methods are unsupported security contexts",
    source: `${imports}
class HiddenAuth {
  static async run() { return getCurrentConnection(); }
  async run() { return getCurrentConnection(); }
}
const Alias = HiddenAuth;
const ExpressionAlias = class {
  async run() { return getCurrentConnection(); }
};
export const GET = async (request: Request) => {${guardedDecoy}
  return readProtectedMailbox(await new Alias().run());
};
export const POST = async (request: Request) => {${guardedDecoy}
  return readProtectedMailbox(await HiddenAuth.run());
};
export const PATCH = async (request: Request) => {${guardedDecoy}
  return readProtectedMailbox(await new ExpressionAlias().run());
};`,
  },
  {
    expected: ["GET"],
    name: "dynamic property writes cannot install a hidden authenticator",
    source: `${imports}
export const GET = async (request: Request) => {${guardedDecoy}
  const hidden: Record<string, unknown> = {};
  hidden["run"] = () => getCurrentConnection();
  const real = await hidden.run();
  return readProtectedMailbox(real);
};`,
  },
  {
    expected: ["GET", "PATCH", "POST"],
    name: "tagged calls this receivers and arguments fail closed",
    source: `${imports}
const invoke = function (candidate: unknown) {
  return arguments[0]();
};
export const GET = async (request: Request) => {${guardedDecoy}
  const hidden = getCurrentConnection;
  return readProtectedMailbox(await hidden\`authenticate\`);
};
export const POST = async (request: Request) => {${guardedDecoy}
  const hidden = {
    auth: getCurrentConnection,
    async run() { return this.auth(); },
  };
  return readProtectedMailbox(await hidden.run());
};
export const PATCH = async (request: Request) => {${guardedDecoy}
  return readProtectedMailbox(await invoke(getCurrentConnection));
};`,
  },
  {
    expected: ["GET"],
    name: "void expressions cannot hide deferred authentication",
    source: `${imports}
const tick = async () => undefined;
export const GET = async (request: Request) => {${guardedDecoy}
  let real;
  void getCurrentConnection().then((value) => { real = value; });
  await tick();
  return readProtectedMailbox(real);
};`,
  },
  {
    expected: ["GET"],
    name: "catch binding defaults are evaluated for authentication escapes",
    source: `${imports}
export const GET = async (request: Request) => {${guardedDecoy}
  try {
    throw {};
  } catch ({ real = getCurrentConnection() }) {
    return readProtectedMailbox(await real);
  }
};`,
  },
];
