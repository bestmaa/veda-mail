import type {
  Mailbox,
  MailboxMutation,
} from "@/domain/mail/mail";
import type { MailboxId } from "@/domain/shared/brand";
import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import { hasUnpairedContentSurrogate } from "@/domain/mail/outgoing-content-policy";

export type MailboxPolicyFailure =
  | "child-exists"
  | "conflict"
  | "cycle"
  | "forbidden"
  | "mail-exists"
  | "missing"
  | "name"
  | "too-deep"
  | "too-many";

export class MailboxPolicyError extends Error {
  public constructor(
    public readonly failure: MailboxPolicyFailure,
    message: string,
  ) {
    super(message);
    this.name = "MailboxPolicyError";
  }
}

export const MAX_CUSTOM_MAILBOXES = 256;
export const MAX_MAILBOX_DEPTH = 8;
export const MAX_MAILBOX_NAME_BYTES = 255;

const fail = (failure: MailboxPolicyFailure, message: string): never => {
  throw new MailboxPolicyError(failure, message);
};

export const assertMailboxName = (name: string): void => {
  if (
    name.length === 0 ||
    name !== name.trim() ||
    new TextEncoder().encode(name).byteLength > MAX_MAILBOX_NAME_BYTES ||
    hasHeaderControlCharacter(name) ||
    hasUnpairedContentSurrogate(name)
  ) {
    fail("name", "Enter a valid mailbox name.");
  }
};

const requiredMailbox = (
  mailboxes: readonly Mailbox[],
  mailboxId: MailboxId,
): Mailbox => {
  const mailbox = mailboxes.find(({ id }) => id === mailboxId);
  return mailbox ?? fail("missing", "The mailbox no longer exists.");
};

const assertParent = (
  mailboxes: readonly Mailbox[],
  parentId: MailboxId | null,
): Mailbox | null => {
  if (!parentId) return null;
  const parent = requiredMailbox(mailboxes, parentId);
  if (!parent.rights.mayCreateChild) {
    fail("forbidden", "The selected mailbox cannot contain child mailboxes.");
  }
  return parent;
};

const assertUniqueName = (
  mailboxes: readonly Mailbox[],
  name: string,
  parentId: MailboxId | null,
  exceptId?: MailboxId,
): void => {
  const normalized = name.normalize("NFKC").toLowerCase();
  if (
    mailboxes.some(
      (mailbox) =>
        mailbox.id !== exceptId &&
        mailbox.parentId === parentId &&
        mailbox.name.normalize("NFKC").toLowerCase() === normalized,
    )
  ) {
    fail("conflict", "A mailbox with this name already exists here.");
  }
};

const assertHierarchy = (
  mailboxes: readonly Mailbox[],
  mailboxId: MailboxId | null,
  parentId: MailboxId | null,
): void => {
  const byId = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  let current = parentId;
  let depth = 1;
  const visited = new Set<MailboxId>();
  while (current) {
    if (current === mailboxId || visited.has(current)) {
      fail("cycle", "A mailbox cannot be nested inside itself.");
    }
    visited.add(current);
    depth += 1;
    if (depth > MAX_MAILBOX_DEPTH) {
      fail("too-deep", `Mailboxes can be nested up to ${MAX_MAILBOX_DEPTH} levels.`);
    }
    current = byId.get(current)?.parentId ?? null;
  }
};

export const assertMailboxMutation = (
  mailboxes: readonly Mailbox[],
  mutation: MailboxMutation,
): void => {
  if (mutation.type === "create") {
    assertMailboxName(mutation.name);
    if (mailboxes.filter(({ role }) => role === "custom").length >= MAX_CUSTOM_MAILBOXES) {
      fail("too-many", "This account has reached the custom mailbox limit.");
    }
    assertParent(mailboxes, mutation.parentId);
    assertHierarchy(mailboxes, null, mutation.parentId);
    assertUniqueName(mailboxes, mutation.name, mutation.parentId);
    return;
  }

  const mailbox = requiredMailbox(mailboxes, mutation.mailboxId);
  if (mailbox.role !== "custom") {
    fail("forbidden", "System mailboxes cannot be changed.");
  }
  if (mutation.type === "delete") {
    if (!mailbox.rights.mayDelete) fail("forbidden", "This mailbox cannot be deleted.");
    if (mailbox.total > 0) fail("mail-exists", "Empty this mailbox before deleting it.");
    if (mailboxes.some(({ parentId }) => parentId === mailbox.id)) {
      fail("child-exists", "Remove or move child mailboxes before deleting this mailbox.");
    }
    return;
  }

  if (!mailbox.rights.mayRename) fail("forbidden", "This mailbox cannot be changed.");
  const name = mutation.name ?? mailbox.name;
  const parentId = mutation.parentId === undefined
    ? mailbox.parentId
    : mutation.parentId;
  assertMailboxName(name);
  assertParent(mailboxes, parentId);
  assertHierarchy(mailboxes, mailbox.id, parentId);
  assertUniqueName(mailboxes, name, parentId, mailbox.id);
};
