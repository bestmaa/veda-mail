const REPLY_INTRO = /^On .{1,500} wrote:\s*$/iu;
const FORWARDED_INTRO = /^-{2,}\s*Forwarded message\s*-{2,}\s*$/iu;
const QUOTED_LINE = /^\s*>/u;

export interface PlainMessageContent {
  readonly quoted: string;
  readonly visible: string;
}

const quoteStart = (lines: readonly string[]): number => {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (FORWARDED_INTRO.test(line)) return index;
    if (QUOTED_LINE.test(line)) return index;
    if (
      REPLY_INTRO.test(line) &&
      lines.slice(index + 1, index + 4).some((candidate) =>
        QUOTED_LINE.test(candidate ?? ""),
      )
    ) return index;
  }
  return -1;
};

export const splitPlainMessageContent = (
  value: string | null | undefined,
): PlainMessageContent => {
  const normalized = value ?? "";
  const lines = normalized.split(/\r?\n/u);
  const start = quoteStart(lines);
  if (start < 0) return { quoted: "", visible: normalized };
  return {
    quoted: lines.slice(start).join("\n").trim(),
    visible: lines.slice(0, start).join("\n").trimEnd(),
  };
};

export const hasSanitizedHtmlQuote = (value: string): boolean =>
  /<blockquote(?:\s|>)/iu.test(value);
