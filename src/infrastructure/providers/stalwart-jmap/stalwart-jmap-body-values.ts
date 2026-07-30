import "server-only";

import {
  MAX_JMAP_BODY_VALUE_CHARACTERS,
  MAX_JMAP_BODY_VALUE_PARTS,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

type UnknownRecord = Readonly<Record<string, unknown>>;

const record = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

export const boundJmapBodyValues = (
  value: unknown,
  partProperties: readonly string[],
): unknown => {
  const email = record(value);
  const source = record(email?.["bodyValues"]);
  if (!email || !source) return value;
  const bounded: Record<string, unknown> = {};
  const seen = new Set<string>();
  let remaining = MAX_JMAP_BODY_VALUE_CHARACTERS;
  let truncated = false;
  let inspectedParts = 0;
  outer:
  for (const property of partProperties) {
    const parts = email[property];
    if (!Array.isArray(parts)) continue;
    for (const rawPart of parts) {
      if (inspectedParts >= MAX_JMAP_BODY_VALUE_PARTS) {
        truncated = true;
        break outer;
      }
      inspectedParts += 1;
      const partId = record(rawPart)?.["partId"];
      if (typeof partId !== "string" || seen.has(partId)) continue;
      const rawBodyValue = record(source[partId]);
      const rawText = rawBodyValue?.["value"];
      if (typeof rawText !== "string") continue;
      if (remaining === 0 && rawText.length > 0) {
        truncated = true;
        break outer;
      }
      seen.add(partId);
      const text = rawText.slice(0, remaining);
      const isTruncated =
        rawBodyValue?.["isTruncated"] === true || text.length < rawText.length;
      bounded[partId] = { isTruncated, value: text };
      remaining -= text.length;
      truncated ||= isTruncated;
    }
  }
  return {
    ...email,
    bodyValues: bounded,
    bodyValuesTruncated: truncated,
  };
};
