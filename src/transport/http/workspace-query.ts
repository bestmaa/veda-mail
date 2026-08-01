import { z } from "zod";

import { MESSAGE_LIST_SORTS } from "@/domain/mail/message-list-preferences";
import { ApiError } from "@/transport/http/api-error";

const ALLOWED_PARAMETERS = new Set([
  "cursor",
  "mailboxId",
  "preview",
  "search",
  "sort",
]);
const mailboxIdSchema = z.string().min(1).max(2_048);
const cursorSchema = z.string().min(1).max(2_048);
const sortSchema = z.enum(MESSAGE_LIST_SORTS);

const one = (params: URLSearchParams, name: string): string | undefined => {
  const values = params.getAll(name);
  if (values.length > 1) {
    throw new ApiError(
      `The ${name} parameter must be supplied once.`,
      "INVALID_MAILBOX_QUERY",
      400,
    );
  }
  return values[0];
};

const requiredWhenPresent = (
  value: string | undefined,
  name: string,
): string | undefined => {
  if (value === "") {
    throw new ApiError(
      `The ${name} parameter cannot be empty.`,
      "INVALID_MAILBOX_QUERY",
      400,
    );
  }
  return value;
};

export const parseWorkspaceQuery = (request: Request) => {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMETERS.has(key)) {
      throw new ApiError(
        "The mailbox query contains an unsupported parameter.",
        "INVALID_MAILBOX_QUERY",
        400,
      );
    }
  }
  const rawSearch = one(params, "search");
  if (rawSearch !== undefined && rawSearch.length > 200) {
    throw new ApiError("The mailbox search is too long.", "INVALID_MAILBOX_QUERY", 400);
  }
  const search = rawSearch?.trim();
  const rawPreview = one(params, "preview");
  if (rawPreview !== undefined && rawPreview !== "show" && rawPreview !== "hide") {
    throw new ApiError("The preview preference is invalid.", "INVALID_MAILBOX_QUERY", 400);
  }
  const rawSort = requiredWhenPresent(one(params, "sort"), "sort");
  const rawCursor = requiredWhenPresent(one(params, "cursor"), "cursor");
  const rawMailboxId = requiredWhenPresent(
    one(params, "mailboxId"),
    "mailboxId",
  );
  if (rawCursor && !rawMailboxId) {
    throw new ApiError(
      "The mailbox cursor is missing its mailbox.",
      "INVALID_MAILBOX_QUERY",
      400,
    );
  }
  return {
    ...(rawCursor ? { cursor: cursorSchema.parse(rawCursor) } : {}),
    ...(rawMailboxId ? { mailboxId: mailboxIdSchema.parse(rawMailboxId) } : {}),
    ...(rawPreview ? { showPreview: rawPreview === "show" } : {}),
    ...(search ? { search } : {}),
    ...(rawSort ? { sort: sortSchema.parse(rawSort) } : {}),
  };
};
