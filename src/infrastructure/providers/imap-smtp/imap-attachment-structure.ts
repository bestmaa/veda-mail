import "server-only";

import type { MessageStructureObject } from "imapflow";

import { isSupportedReceivedInlineImageMimeType } from "@/domain/mail/inline-image";
import { normalizeContentId } from "@/domain/mail/received-attachment";
import {
  normalizeAttachmentFilename,
  normalizeAttachmentMimeType,
} from "@/infrastructure/providers/imap-smtp/mime-attachment-headers";

const SAFE_PART = /^(?:[1-9]\d*)(?:\.(?:[1-9]\d*)){0,31}$/;
const MAX_STRUCTURE_NODES = 512;
const MAX_STRUCTURE_DEPTH = 32;
export const isSupportedImapInlineRasterType = (mimeType: string): boolean =>
  isSupportedReceivedInlineImageMimeType(mimeType);

export interface ImapAttachmentPart {
  readonly contentId: string | null;
  readonly contentType: string;
  readonly disposition: "attachment" | "inline";
  readonly filename: string;
  readonly part: string;
  readonly size: number | null;
  readonly transferEncoding: string | null;
}

export interface ImapAttachmentDownloadTarget {
  readonly expectedSize: number | null;
  readonly part: string;
  readonly uid: number;
  readonly uidValidity: string | null;
}

const parameter = (
  values: Record<string, string> | undefined,
  name: string,
): string | undefined => {
  if (!values) return undefined;
  const match = Object.entries(values).find(
    ([key]) => key.toLowerCase() === name,
  );
  return match?.[1];
};

const effectivePart = (
  node: MessageStructureObject,
  isRoot: boolean,
): string | undefined =>
  node.part ?? (isRoot && !node.childNodes?.length ? "1" : undefined);

const attachmentFilename = (node: MessageStructureObject): string | undefined =>
  parameter(node.dispositionParameters, "filename") ??
  parameter(node.parameters, "name");

const transferEncoding = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(normalized) ? normalized : null;
};

const toAttachment = (
  node: MessageStructureObject,
  isRoot: boolean,
): ImapAttachmentPart | null => {
  const filename = attachmentFilename(node);
  const disposition = node.disposition?.trim().toLowerCase();
  const contentType = normalizeAttachmentMimeType(node.type);
  const normalizedContentId = normalizeContentId(node.id?.trim() ?? "");
  const isLeaf = !node.childNodes?.length;
  const isCidImageLeaf =
    Boolean(normalizedContentId) &&
    contentType.startsWith("image/") &&
    isLeaf;
  const isCidRasterLeaf =
    isCidImageLeaf &&
    isSupportedImapInlineRasterType(contentType) &&
    isLeaf;
  const isAttachment =
    disposition === "attachment" ||
    (disposition === "inline" && isLeaf) ||
    Boolean(filename) ||
    isCidImageLeaf;
  if (!isAttachment) return null;
  const part = effectivePart(node, isRoot);
  if (!part) return null;
  return {
    contentId: normalizedContentId,
    contentType,
    disposition:
      isCidRasterLeaf && disposition !== "attachment"
        ? "inline"
        : "attachment",
    filename: normalizeAttachmentFilename(filename ?? "attachment.bin"),
    part: assertSafeImapPartSpecifier(part),
    size:
      Number.isSafeInteger(node.size) && (node.size ?? -1) >= 0
        ? (node.size ?? null)
        : null,
    transferEncoding: transferEncoding(node.encoding),
  };
};

export const assertSafeImapPartSpecifier = (value: string): string => {
  if (value.length > 128 || !SAFE_PART.test(value)) {
    throw new Error("IMAP body part specifier is invalid.");
  }
  return value;
};

export const collectImapAttachmentParts = (
  structure: MessageStructureObject,
): readonly ImapAttachmentPart[] => {
  const results: ImapAttachmentPart[] = [];
  const partCounts = new Map<string, number>();
  const pending: {
    readonly depth: number;
    readonly isRoot: boolean;
    readonly node: MessageStructureObject;
  }[] = [{ depth: 0, isRoot: true, node: structure }];
  const visited = new Set<MessageStructureObject>();
  let nodeCount = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry || visited.has(entry.node)) continue;
    visited.add(entry.node);
    nodeCount += 1;
    if (nodeCount > MAX_STRUCTURE_NODES || entry.depth > MAX_STRUCTURE_DEPTH) {
      throw new Error("IMAP body structure exceeds safe traversal limits.");
    }
    const part = effectivePart(entry.node, entry.isRoot);
    if (part) partCounts.set(part, (partCounts.get(part) ?? 0) + 1);
    const attachment = toAttachment(entry.node, entry.isRoot);
    if (attachment) results.push(attachment);
    const children = entry.node.childNodes ?? [];
    if (children.length + visited.size > MAX_STRUCTURE_NODES) {
      throw new Error("IMAP body structure exceeds safe traversal limits.");
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) {
        pending.push({
          depth: entry.depth + 1,
          isRoot: false,
          node: child,
        });
      }
    }
  }
  return results.filter(({ part }) => partCounts.get(part) === 1);
};

export const hasImapDownloadableAttachment = (
  structure?: MessageStructureObject,
): boolean => {
  if (!structure) return false;
  try {
    return collectImapAttachmentParts(structure).some(
      ({ disposition }) => disposition === "attachment",
    );
  } catch {
    return false;
  }
};

export const findImapBodyPart = (
  structure: MessageStructureObject,
  part: string,
): MessageStructureObject | null => {
  const safePart = assertSafeImapPartSpecifier(part);
  const pending: {
    readonly depth: number;
    readonly isRoot: boolean;
    readonly node: MessageStructureObject;
  }[] = [{ depth: 0, isRoot: true, node: structure }];
  const visited = new Set<MessageStructureObject>();
  let match: MessageStructureObject | null = null;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry || visited.has(entry.node)) continue;
    visited.add(entry.node);
    if (
      visited.size > MAX_STRUCTURE_NODES ||
      entry.depth > MAX_STRUCTURE_DEPTH
    ) {
      throw new Error("IMAP body structure exceeds safe traversal limits.");
    }
    if (effectivePart(entry.node, entry.isRoot) === safePart) {
      if (match) return null;
      match = entry.node;
    }
    const children = entry.node.childNodes ?? [];
    if (children.length + visited.size > MAX_STRUCTURE_NODES) {
      throw new Error("IMAP body structure exceeds safe traversal limits.");
    }
    for (const child of children) {
      pending.push({
        depth: entry.depth + 1,
        isRoot: false,
        node: child,
      });
    }
  }
  return match;
};

export const createImapAttachmentDownloadTarget = (
  uid: number,
  attachment: ImapAttachmentPart,
  uidValidity?: bigint,
): ImapAttachmentDownloadTarget => {
  if (!Number.isSafeInteger(uid) || uid <= 0) {
    throw new Error("IMAP message UID must be a positive safe integer.");
  }
  if (uidValidity !== undefined && uidValidity <= BigInt(0)) {
    throw new Error("IMAP UIDVALIDITY must be positive.");
  }
  return {
    expectedSize: attachment.size,
    part: assertSafeImapPartSpecifier(attachment.part),
    uid,
    uidValidity: uidValidity?.toString() ?? null,
  };
};
