const imports = `
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { readProtectedMailbox } from "@/server/mail/protected";
import { assertSubjectRateLimit } from "@/server/security/rate-limit";
`;

export const RATE_SESSION_SCOPE_ROUTE_FIXTURES = [
  {
    expected: [],
    name: "a subject rate check may safely run before the scope guard",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertSubjectRateLimit("mail-read", connection.id, 5, 60_000);
  assertMailSessionScope(request, connection);
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    name: "a subject rate check does not replace the scope guard",
    source: `${imports}
export const GET = async () => {
  const connection = await getCurrentConnection();
  assertSubjectRateLimit("mail-read", connection.id, 5, 60_000);
  return readProtectedMailbox(connection);
};`,
  },
];
