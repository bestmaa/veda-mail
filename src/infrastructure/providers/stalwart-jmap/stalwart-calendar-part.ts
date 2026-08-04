import "server-only";

import { normalizeReceivedAttachmentMimeType, sanitizeReceivedAttachmentName } from "@/domain/mail/received-attachment";
import { attachmentIdsEqual, createOpaqueReceivedAttachmentId } from "@/infrastructure/providers/attachment-identity";
import type { JmapBodyPart } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const MAX_STRUCTURE_NODES = 512;
const MAX_STRUCTURE_DEPTH = 32;

interface RawBodyPart extends JmapBodyPart {
  readonly subParts?: readonly unknown[];
}

export interface StalwartCalendarPart {
  readonly blobId: string;
  readonly id: string;
  readonly name: string;
  readonly part: JmapBodyPart;
  readonly size: number | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const safeText = (value: unknown, maximum: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= maximum &&
    ![...value].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 0x1f || point === 0x7f;
    }) ? value : null;

const bodyPart = (value: unknown): RawBodyPart | null => {
  const source = record(value);
  if (!source) return null;
  if (
    source["subParts"] !== undefined && source["subParts"] !== null &&
    !Array.isArray(source["subParts"])
  ) {
    throw new Error("JMAP body structure is invalid.");
  }
  const type = safeText(source["type"], 256);
  if (!type) return null;
  return {
    type,
    ...(source["blobId"] === null
      ? { blobId: null }
      : safeText(source["blobId"], 1_024)
        ? { blobId: source["blobId"] as string }
        : {}),
    ...(source["partId"] === null
      ? { partId: null }
      : safeText(source["partId"], 1_024)
        ? { partId: source["partId"] as string }
        : {}),
    ...(source["name"] === null
      ? { name: null }
      : typeof source["name"] === "string" && source["name"].length <= 4_096
        ? { name: source["name"] }
        : {}),
    ...(source["disposition"] === null
      ? { disposition: null }
      : safeText(source["disposition"], 256)
        ? { disposition: source["disposition"] as string }
        : {}),
    ...(source["size"] === null
      ? { size: null }
      : Number.isSafeInteger(source["size"]) && Number(source["size"]) >= 0
        ? { size: Number(source["size"]) }
        : {}),
    ...(Array.isArray(source["subParts"])
      ? { subParts: source["subParts"] }
      : {}),
  };
};

const isCalendar = (part: RawBodyPart): boolean => {
  if (normalizeReceivedAttachmentMimeType(part.type) !== "text/calendar") {
    return false;
  }
  const disposition = part.disposition?.trim().toLowerCase();
  return !disposition || disposition === "inline" || disposition === "attachment";
};

export const collectStalwartCalendarParts = (
  accountId: string,
  messageId: string,
  structure: unknown,
): readonly StalwartCalendarPart[] => {
  const pending = [{ depth: 0, value: structure }];
  const visited = new Set<object>();
  const candidates: { readonly part: RawBodyPart; readonly ordinal: number }[] = [];
  let ordinal = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    const identity = record(entry.value);
    if (!identity || visited.has(identity)) continue;
    visited.add(identity);
    if (visited.size > MAX_STRUCTURE_NODES || entry.depth > MAX_STRUCTURE_DEPTH) {
      throw new Error("JMAP body structure exceeds safe traversal limits.");
    }
    const part = bodyPart(entry.value);
    if (!part) continue;
    const children = part.subParts ?? [];
    if (children.length + visited.size > MAX_STRUCTURE_NODES) {
      throw new Error("JMAP body structure exceeds safe traversal limits.");
    }
    if (isCalendar(part) && children.length === 0 && safeText(part.blobId, 1_024)) {
      candidates.push({ part, ordinal: ordinal++ });
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) pending.push({ depth: entry.depth + 1, value: child });
    }
  }
  const identities = new Map<string, number>();
  for (const { part } of candidates) {
    const key = JSON.stringify([part.partId ?? null, part.blobId]);
    identities.set(key, (identities.get(key) ?? 0) + 1);
  }
  return candidates.flatMap(({ part, ordinal }) => {
    const key = JSON.stringify([part.partId ?? null, part.blobId]);
    if (identities.get(key) !== 1 || !part.blobId) return [];
    const name = sanitizeReceivedAttachmentName(part.name ?? "invite.ics");
    const size = Number.isSafeInteger(part.size) && (part.size ?? -1) >= 0
      ? part.size ?? null : null;
    return [{
      blobId: part.blobId,
      id: createOpaqueReceivedAttachmentId("stalwart-jmap", [
        "calendar", accountId, messageId, ordinal, part.partId ?? null,
        part.blobId, name, size,
      ]),
      name,
      part: { ...part, disposition: "attachment", name },
      size,
    }];
  });
};

export const findStalwartCalendarPart = (
  accountId: string,
  messageId: string,
  structure: unknown,
  calendarPartId: string,
): StalwartCalendarPart | null =>
  collectStalwartCalendarParts(accountId, messageId, structure).find(({ id }) =>
    attachmentIdsEqual(id, calendarPartId)) ?? null;
