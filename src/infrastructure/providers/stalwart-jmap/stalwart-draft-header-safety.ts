import "server-only";

import { safeMessageId, safeReplyReferences } from "@/infrastructure/providers/message-id";
import { contentTypeParametersAreSafe } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-mime-safety";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";

const values = (input?: readonly string[] | null): readonly string[] =>
  input ?? [];

export const hasLosslessDraftHeaders = (email: JmapDraftEmail): boolean => {
  const messageIds = values(email.messageId);
  const inReplyTo = values(email.inReplyTo);
  const ownId = safeMessageId(messageIds[0]);
  const parent = safeMessageId(inReplyTo[0]);
  const references = values(email.references);
  return (
    messageIds.length === 1 &&
    ownId === messageIds[0] &&
    inReplyTo.length <= 1 &&
    (inReplyTo.length === 0 || parent === inReplyTo[0]) &&
    JSON.stringify(references) ===
      JSON.stringify(parent ? safeReplyReferences(references, parent) : [])
  );
};

const ALLOWED_HEADER_NAMES = new Set([
  "bcc",
  "cc",
  "content-transfer-encoding",
  "content-type",
  "date",
  "from",
  "in-reply-to",
  "message-id",
  "mime-version",
  "references",
  "subject",
  "to",
]);

const normalizedAddresses = (
  input?: readonly {
    readonly email: string;
    readonly name?: string | null | undefined;
  }[] | null,
) =>
  (input ?? []).map(({ email, name }) => ({ email, name: name ?? null }));

type GroupedProperty =
  | "header:Bcc:asGroupedAddresses:all"
  | "header:Cc:asGroupedAddresses:all"
  | "header:From:asGroupedAddresses:all"
  | "header:To:asGroupedAddresses:all";

const groupedAddressesMatch = (
  email: JmapDraftEmail,
  property: GroupedProperty,
  expected: JmapDraftEmail["bcc"],
  expectedInstances: number,
): boolean => {
  const instances = email[property];
  if (instances === undefined || (instances?.length ?? 0) !== expectedInstances) {
    return false;
  }
  if (expectedInstances === 0) return (expected?.length ?? 0) === 0;
  const groups = instances?.[0];
  if (groups === null) {
    const headerName = property.slice("header:".length).split(":", 1)[0];
    const raw = email.headers?.find(
      ({ name }) => name.toLowerCase() === headerName?.toLowerCase(),
    );
    return (expected?.length ?? 0) === 0 && raw?.value.trim() === "";
  }
  if (!groups) return false;
  if (groups.some(({ name }) => name !== null)) return false;
  const flattened = groups.flatMap(({ addresses }) => addresses ?? []);
  return (
    flattened.length > 0 &&
    JSON.stringify(normalizedAddresses(flattened)) ===
      JSON.stringify(normalizedAddresses(expected))
  );
};

export const hasSupportedDraftHeaderInventory = (
  email: JmapDraftEmail,
): boolean => {
  if (email.headers === undefined) return false;
  const names = email.headers.map(({ name }) => name.toLowerCase());
  const count = (name: string) => names.filter((value) => value === name).length;
  const contentType = email.headers.find(
    ({ name }) => name.toLowerCase() === "content-type",
  );
  const mimeVersion = email.headers.find(
    ({ name }) => name.toLowerCase() === "mime-version",
  );
  const structureType = email.bodyStructure?.type.trim().toLowerCase();
  if (
    !names.every((name) => ALLOWED_HEADER_NAMES.has(name)) ||
    new Set(names).size !== names.length ||
    count("from") !== 1 ||
    count("message-id") !== 1 ||
    count("content-type") !== 1 ||
    !structureType ||
    !contentTypeParametersAreSafe(contentType?.value ?? "", structureType) ||
    (mimeVersion !== undefined && mimeVersion.value.trim() !== "1.0") ||
    count("in-reply-to") !== (values(email.inReplyTo).length ? 1 : 0) ||
    count("references") !== (values(email.references).length ? 1 : 0)
  ) {
    return false;
  }
  return [
    ["header:From:asGroupedAddresses:all", email.from, count("from")],
    ["header:To:asGroupedAddresses:all", email.to, count("to")],
    ["header:Cc:asGroupedAddresses:all", email.cc, count("cc")],
    ["header:Bcc:asGroupedAddresses:all", email.bcc, count("bcc")],
  ].every(([property, addresses, instances]) =>
    groupedAddressesMatch(
      email,
      property as GroupedProperty,
      addresses as JmapDraftEmail["bcc"],
      instances as number,
    ),
  );
};
