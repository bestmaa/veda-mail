export const MAX_MESSAGE_LIST_PREVIEW_CHARACTERS = 320;
export const MAX_MESSAGE_LIST_PREVIEW_UTF8_BYTES = 1_024;

const encoder = new TextEncoder();

const unsafeControl = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069);
};

export const normalizeMessageListPreview = (input: string): string => {
  const normalized = [...input]
    .map((character) => unsafeControl(character) ? " " : character)
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  let result = "";
  let characters = 0;
  let bytes = 0;
  for (const character of normalized) {
    const characterBytes = encoder.encode(character).byteLength;
    if (
      characters >= MAX_MESSAGE_LIST_PREVIEW_CHARACTERS ||
      bytes + characterBytes > MAX_MESSAGE_LIST_PREVIEW_UTF8_BYTES
    ) break;
    result += character;
    characters += 1;
    bytes += characterBytes;
  }
  return result;
};
