import "server-only";

import { z } from "zod";

import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";

const MAX_JMAP_RECORD_KEYS = 1_024;
const MAX_JMAP_KEY_BYTES = 255;
const invalidRecord = Symbol("invalid-jmap-record");
const DISALLOWED_JMAP_KEYWORD_CHARACTERS = new Set([
  '"',
  "%",
  "(",
  ")",
  "*",
  "\\",
  "]",
  "{",
]);

type JmapKeyKind = "id" | "keyword";

const validKeyword = (value: string): boolean => {
  if (value.length === 0 || value.length > MAX_JMAP_KEY_BYTES) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      code < 0x21 ||
      code > 0x7e ||
      (code >= 0x41 && code <= 0x5a) ||
      DISALLOWED_JMAP_KEYWORD_CHARACTERS.has(character)
    ) {
      return false;
    }
  }
  return true;
};

const validId = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_JMAP_KEY_BYTES &&
  outgoingContentUtf8Bytes(value) <= MAX_JMAP_KEY_BYTES &&
  !hasDisallowedContentControl(value) &&
  !hasUnpairedContentSurrogate(value) &&
  /^[A-Za-z0-9_-]+$/.test(value);

const validKey = (value: string, kind: JmapKeyKind): boolean =>
  kind === "keyword" ? validKeyword(value) : validId(value);

const inspectRecord = (value: unknown, kind: JmapKeyKind): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  let count = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    count += 1;
    if (count > MAX_JMAP_RECORD_KEYS || !validKey(key, kind)) {
      return invalidRecord;
    }
  }
  return value;
};

export const jmapIdBooleanRecordSchema = z.preprocess(
  (value) => inspectRecord(value, "id"),
  z.record(z.string(), z.boolean()),
);

export const jmapKeywordBooleanRecordSchema = z.preprocess(
  (value) => inspectRecord(value, "keyword"),
  z.record(z.string(), z.boolean()),
);
