import "server-only";

import type { MessageStructureObject } from "imapflow";

import { normalizeReceivedAttachmentMimeType, sanitizeReceivedAttachmentName } from "@/domain/mail/received-attachment";
import { attachmentIdsEqual, createOpaqueReceivedAttachmentId } from "@/infrastructure/providers/attachment-identity";
import { assertSafeImapPartSpecifier } from "@/infrastructure/providers/imap-smtp/imap-attachment-structure";

const MAX_STRUCTURE_NODES = 512;
const MAX_STRUCTURE_DEPTH = 32;

export interface ImapCalendarPart {
  readonly id: string;
  readonly name: string;
  readonly part: string;
  readonly size: null;
  readonly transferEncoding: string | null;
}

interface BindImapCalendarInput {
  readonly accountScope: string;
  readonly messageId: string;
  readonly structure: MessageStructureObject;
  readonly uidValidity: bigint;
}

const parameter = (
  values: Record<string, string> | undefined,
  name: string,
): string | undefined => Object.entries(values ?? {}).find(
  ([key]) => key.toLowerCase() === name,
)?.[1];

const effectivePart = (
  node: MessageStructureObject,
  isRoot: boolean,
): string | null => {
  const value = node.part ?? (isRoot && !node.childNodes?.length ? "1" : null);
  return value ? assertSafeImapPartSpecifier(value) : null;
};

const transferEncoding = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9-]{0,31}$/u.test(normalized) ? normalized : null;
};

const isCalendar = (node: MessageStructureObject): boolean => {
  if (normalizeReceivedAttachmentMimeType(node.type) !== "text/calendar") {
    return false;
  }
  const disposition = node.disposition?.trim().toLowerCase();
  return !disposition || disposition === "inline" || disposition === "attachment";
};

export const collectImapCalendarParts = (
  input: BindImapCalendarInput,
): readonly ImapCalendarPart[] => {
  if (input.uidValidity <= BigInt(0)) {
    throw new Error("IMAP UIDVALIDITY must be positive.");
  }
  const pending = [{ depth: 0, isRoot: true, node: input.structure }];
  const visited = new Set<MessageStructureObject>();
  const candidates: {
    readonly encoding: string | null;
    readonly name: string;
    readonly ordinal: number;
    readonly part: string;
  }[] = [];
  let ordinal = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry || visited.has(entry.node)) continue;
    visited.add(entry.node);
    if (visited.size > MAX_STRUCTURE_NODES || entry.depth > MAX_STRUCTURE_DEPTH) {
      throw new Error("IMAP body structure exceeds safe traversal limits.");
    }
    const children = entry.node.childNodes ?? [];
    if (children.length + visited.size > MAX_STRUCTURE_NODES) {
      throw new Error("IMAP body structure exceeds safe traversal limits.");
    }
    const part = effectivePart(entry.node, entry.isRoot);
    if (part && children.length === 0 && isCalendar(entry.node)) {
      const providedName = parameter(entry.node.dispositionParameters, "filename") ??
        parameter(entry.node.parameters, "name") ?? "invite.ics";
      candidates.push({
        encoding: transferEncoding(entry.node.encoding),
        name: sanitizeReceivedAttachmentName(providedName),
        ordinal: ordinal++,
        part,
      });
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) {
        pending.push({ depth: entry.depth + 1, isRoot: false, node: child });
      }
    }
  }
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.part, (counts.get(candidate.part) ?? 0) + 1);
  }
  const uidValidity = input.uidValidity.toString();
  return candidates.flatMap((candidate) => counts.get(candidate.part) === 1
    ? [{
        id: createOpaqueReceivedAttachmentId("imap-smtp", [
          "calendar", input.accountScope, input.messageId, uidValidity,
          candidate.ordinal, candidate.part, candidate.encoding, candidate.name,
        ]),
        name: candidate.name,
        part: candidate.part,
        size: null,
        transferEncoding: candidate.encoding,
      }]
    : []);
};

export const findImapCalendarPart = (
  input: BindImapCalendarInput,
  calendarPartId: string,
): ImapCalendarPart | null =>
  collectImapCalendarParts(input).find(({ id }) =>
    attachmentIdsEqual(id, calendarPartId)) ?? null;
