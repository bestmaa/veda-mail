import "server-only";

import type { Mailbox } from "@/domain/mail/mailbox";

export const sieveMailboxNames = (
  mailboxes: readonly Mailbox[],
  separator = "/",
): Readonly<Record<string, string>> => {
  if (!separator || /[\r\n\0]/u.test(separator)) {
    throw new Error("The mailbox hierarchy separator is invalid.");
  }
  const byId = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  const names: Record<string, string> = {};
  const resolve = (mailbox: Mailbox, seen: Set<string>): string => {
    if (seen.has(mailbox.id)) {
      throw new Error("The mailbox hierarchy contains a cycle.");
    }
    if (!mailbox.parentId) return mailbox.name;
    const parent = byId.get(mailbox.parentId);
    if (!parent) throw new Error("The mailbox hierarchy is incomplete.");
    return `${resolve(parent, new Set(seen).add(mailbox.id))}${separator}${mailbox.name}`;
  };
  for (const mailbox of mailboxes) {
    names[mailbox.id] = resolve(mailbox, new Set());
  }
  return names;
};

export const sieveDeliveryMailboxNames = (
  mailboxes: readonly Mailbox[],
  separator = "/",
): Readonly<Record<string, string>> => {
  const names = sieveMailboxNames(mailboxes, separator);
  return Object.fromEntries(mailboxes
    .filter((mailbox) =>
      mailbox.rights.mayAddItems === true &&
      mailbox.role !== "drafts" &&
      mailbox.role !== "sent")
    .map((mailbox) => [mailbox.id, names[mailbox.id]!]));
};
