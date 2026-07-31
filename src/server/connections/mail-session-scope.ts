import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { ApiError } from "@/transport/http/api-error";

export const MAIL_SESSION_SCOPE_HEADER = "x-veda-mail-session-scope";

const scopeFor = (
  connection: Readonly<{ id: string }>,
): string =>
  createHash("sha256")
    .update("veda-mail/browser-session-scope/v1")
    .update("\0")
    .update(connection.id)
    .digest("base64url");

export const mailSessionScope = scopeFor;

export const assertMailSessionScopeValue = (
  supplied: string | null,
  connection: Readonly<{ id: string }>,
): void => {
  const expected = scopeFor(connection);
  const suppliedBytes = Buffer.from(supplied ?? "", "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    throw new ApiError(
      "Mailbox session changed. Reload this page and try again.",
      "MAIL_SESSION_CHANGED",
      409,
    );
  }
};

export const assertMailSessionScope = (
  request: Request,
  connection: Readonly<{ id: string }>,
): void =>
  assertMailSessionScopeValue(
    request.headers.get(MAIL_SESSION_SCOPE_HEADER),
    connection,
  );
