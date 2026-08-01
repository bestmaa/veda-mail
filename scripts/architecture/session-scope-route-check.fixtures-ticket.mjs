const imports = `
import { getCurrentConnection } from "@/server/connections/connection-session";
import { consumeAttachmentArchiveTicket } from "@/server/mail/attachment-archive-ticket";
import { prepareAttachmentArchive } from "@/server/mail/attachment-archive";
import { acquireAttachmentArchiveLease } from "@/server/mail/attachment-archive-concurrency";
import { getMailService } from "@/server/mail/mail-service";
import { readProtectedMailbox } from "@/server/mail/protected";
`;

const archiveRoute =
  "src/app/api/v1/mail/messages/[messageId]/attachments/archive/route.ts";

export const TICKET_SESSION_SCOPE_ROUTE_FIXTURES = [
  {
    expected: [],
    fileName: archiveRoute,
    name: "the archive GET accepts a request-derived bound ticket",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  const ticket = new URL(request.url).searchParams.get("ticket");
  acquireAttachmentArchiveLease(connection.id);
  consumeAttachmentArchiveTicket({
    connectionId: connection.id,
    messageId: "message-from-route",
    ticket,
  });
  const mail = await getMailService(connection);
  return prepareAttachmentArchive({ mail });
};`,
  },
  {
    expected: ["GET"],
    name: "an archive ticket cannot replace session scope outside its route",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  consumeAttachmentArchiveTicket({
    connectionId: connection.id,
    messageId: "message-from-route",
    ticket: new URL(request.url).searchParams.get("ticket"),
  });
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    fileName: archiveRoute,
    name: "a constant attachment archive ticket cannot guard a connection",
    source: `${imports}
export const GET = async () => {
  const connection = await getCurrentConnection();
  consumeAttachmentArchiveTicket({
    connectionId: connection.id,
    messageId: "message-from-route",
    ticket: "constant-ticket",
  });
  return readProtectedMailbox(connection);
};`,
  },
  {
    expected: ["GET"],
    fileName: archiveRoute,
    name: "an attachment archive ticket must bind the authenticated connection",
    source: `${imports}
export const GET = async (request: Request) => {
  const connection = await getCurrentConnection();
  consumeAttachmentArchiveTicket({
    connectionId: "unrelated",
    messageId: "message-from-route",
    ticket: new URL(request.url).searchParams.get("ticket"),
  });
  return readProtectedMailbox(connection);
};`,
  },
];
