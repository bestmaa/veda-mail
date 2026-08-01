import type { Mailbox } from "@/domain/mail/mailbox";

const roleOrder: Readonly<Record<Mailbox["role"], number>> = {
  inbox: 0,
  drafts: 1,
  sent: 2,
  archive: 3,
  spam: 4,
  trash: 5,
  custom: 6,
};

const compare = (left: Mailbox, right: Mailbox): number =>
  roleOrder[left.role] - roleOrder[right.role] ||
  left.sortOrder - right.sortOrder ||
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" });

export interface MailboxTreeItem {
  readonly depth: number;
  readonly mailbox: Mailbox;
}

export const flattenMailboxTree = (
  mailboxes: readonly Mailbox[],
): readonly MailboxTreeItem[] => {
  const ids = new Set(mailboxes.map(({ id }) => id));
  const children = new Map<string | null, Mailbox[]>();
  for (const mailbox of mailboxes) {
    const parentId = mailbox.parentId && ids.has(mailbox.parentId)
      ? mailbox.parentId
      : null;
    const group = children.get(parentId) ?? [];
    group.push(mailbox);
    children.set(parentId, group);
  }
  for (const group of children.values()) group.sort(compare);
  const result: MailboxTreeItem[] = [];
  const visited = new Set<string>();
  const append = (parentId: string | null, depth: number): void => {
    for (const mailbox of children.get(parentId) ?? []) {
      if (visited.has(mailbox.id)) continue;
      visited.add(mailbox.id);
      result.push({ depth, mailbox });
      append(mailbox.id, depth + 1);
    }
  };
  append(null, 0);
  for (const mailbox of mailboxes.slice().sort(compare)) {
    if (!visited.has(mailbox.id)) result.push({ depth: 0, mailbox });
  }
  return result;
};
