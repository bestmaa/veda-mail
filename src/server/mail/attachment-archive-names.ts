import "server-only";

import {
  sanitizeReceivedAttachmentName,
} from "@/domain/mail/received-attachment";

const MAX_NAME_BYTES = 180;
const encoder = new TextEncoder();

const utf8Length = (value: string): number => encoder.encode(value).byteLength;

const truncateUtf8 = (value: string, maximumBytes: number): string => {
  let output = "";
  for (const character of value) {
    if (utf8Length(output + character) > maximumBytes) break;
    output += character;
  }
  return output;
};

const splitExtension = (
  name: string,
): { readonly extension: string; readonly stem: string } => {
  const match = name.match(/(\.[^./]{1,24})$/u);
  const extension = match?.[1] ?? "";
  return {
    extension,
    stem: extension ? name.slice(0, -extension.length) : name,
  };
};

const collisionKey = (name: string): string =>
  name
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[ .]+$/gu, "");

const suffixedName = (name: string, ordinal: number): string => {
  const safe = sanitizeReceivedAttachmentName(name);
  if (ordinal === 1) return safe;
  const { extension, stem } = splitExtension(safe);
  const suffix = ` (${ordinal})`;
  const maximumStemBytes =
    MAX_NAME_BYTES - utf8Length(suffix) - utf8Length(extension);
  const boundedStem =
    truncateUtf8(stem, Math.max(1, maximumStemBytes)) || "attachment";
  return sanitizeReceivedAttachmentName(
    `${boundedStem}${suffix}${extension}`,
  );
};

export const uniqueArchiveEntryNames = (
  names: readonly string[],
): readonly string[] => {
  const used = new Set<string>();
  return names.map((name) => {
    for (let ordinal = 1; ordinal <= names.length + 1; ordinal += 1) {
      const candidate = suffixedName(name, ordinal);
      const key = collisionKey(candidate);
      if (!used.has(key)) {
        used.add(key);
        return candidate;
      }
    }
    throw new Error("Unable to create a unique attachment archive name.");
  });
};
