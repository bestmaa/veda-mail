import {
  MailSearchSyntaxError,
  type MailSearchCriterion,
  type MailSearchQuery,
  type MailSearchState,
} from "@/domain/mail/mail-search";

const MAX_CRITERIA = 20;
const MAX_VALUE_CHARACTERS = 200;
export const MAX_MAIL_SEARCH_CHARACTERS = 1_000;
const MAX_SEARCH_BYTES = 1_099_511_627_776;
const OPERATORS = new Set([
  "after", "before", "body", "cc", "from", "has", "in", "is", "larger",
  "smaller", "subject", "to",
]);
const TEXT_FIELDS = new Set(["body", "cc", "from", "subject", "to"]);
const STATES = new Set<MailSearchState>([
  "read", "starred", "unread", "unstarred",
]);

interface SearchToken { readonly phrase: boolean; readonly value: string }

const tokenize = (input: string): readonly SearchToken[] => {
  const tokens: SearchToken[] = [];
  let current = "";
  let escaped = false;
  let phrase = false;
  let quoted = false;
  for (const character of input) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quoted) {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
      phrase = true;
    } else if (/\s/u.test(character) && !quoted) {
      if (current) tokens.push({ phrase, value: current });
      current = "";
      phrase = false;
    } else {
      current += character;
    }
  }
  if (quoted || escaped) {
    throw new MailSearchSyntaxError("The mail search contains an unfinished quote.");
  }
  if (current) tokens.push({ phrase, value: current });
  return tokens;
};

const safeValue = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new MailSearchSyntaxError("A mail search operator is missing its value.");
  }
  if (
    normalized.length > MAX_VALUE_CHARACTERS ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159);
    })
  ) {
    throw new MailSearchSyntaxError("A mail search value is invalid or too long.");
  }
  return normalized;
};

const calendarDate = (value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith("0000-")) {
    throw new MailSearchSyntaxError("Search dates must use YYYY-MM-DD.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new MailSearchSyntaxError("The mail search contains an invalid date.");
  }
  return value;
};

const byteSize = (value: string): number => {
  const match = /^(\d+)([kmg]?)(?:b)?$/iu.exec(value);
  if (!match) {
    throw new MailSearchSyntaxError("Search sizes must be bytes or use K, M, or G.");
  }
  const units: Readonly<Record<string, number>> = {
    "": 1, g: 1024 ** 3, k: 1024, m: 1024 ** 2,
  };
  const bytes = Number(match[1]) * (units[match[2]!.toLowerCase()] ?? 0);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_SEARCH_BYTES) {
    throw new MailSearchSyntaxError("The mail search size is outside the supported range.");
  }
  return bytes;
};

const criterion = (token: SearchToken): MailSearchCriterion => {
  const separator = token.value.indexOf(":");
  if (separator < 1) {
    return {
      field: "text",
      ...(token.phrase ? { phrase: true as const } : {}),
      type: "text",
      value: safeValue(token.value),
    };
  }
  const operator = token.value.slice(0, separator).toLowerCase();
  const value = safeValue(token.value.slice(separator + 1));
  if (!OPERATORS.has(operator)) {
    throw new MailSearchSyntaxError(`The ${operator}: search operator is not supported.`);
  }
  if (TEXT_FIELDS.has(operator)) {
    return {
      field: operator as "body" | "cc" | "from" | "subject" | "to",
      ...(token.phrase ? { phrase: true as const } : {}),
      type: "text",
      value,
    };
  }
  if (operator === "after" || operator === "before") {
    return { boundary: operator, date: calendarDate(value), type: "date" };
  }
  if (operator === "larger" || operator === "smaller") {
    return { boundary: operator, bytes: byteSize(value), type: "size" };
  }
  if (operator === "in") return { type: "mailbox", value };
  if (operator === "has") {
    if (value.toLowerCase() !== "attachment") {
      throw new MailSearchSyntaxError("Only has:attachment is supported.");
    }
    return { type: "has-attachment" };
  }
  const state = value.toLowerCase() as MailSearchState;
  if (!STATES.has(state)) {
    throw new MailSearchSyntaxError(
      "The is: operator supports read, unread, starred, or unstarred.",
    );
  }
  return { state, type: "state" };
};

const assertCompatible = (criteria: readonly MailSearchCriterion[]): void => {
  const state = (value: MailSearchState) =>
    criteria.some((item) => item.type === "state" && item.state === value);
  if ((state("read") && state("unread")) ||
      (state("starred") && state("unstarred"))) {
    throw new MailSearchSyntaxError("The mail search contains conflicting states.");
  }
  if (criteria.filter((item) => item.type === "mailbox").length > 1) {
    throw new MailSearchSyntaxError("Only one in: mailbox may be searched at a time.");
  }
  const dates = (boundary: "after" | "before") => criteria
    .filter((item): item is Extract<MailSearchCriterion, { type: "date" }> =>
      item.type === "date" && item.boundary === boundary)
    .map((item) => item.date);
  const sizes = (boundary: "larger" | "smaller") => criteria
    .filter((item): item is Extract<MailSearchCriterion, { type: "size" }> =>
      item.type === "size" && item.boundary === boundary)
    .map((item) => item.bytes);
  const after = dates("after").sort().at(-1);
  const before = dates("before").sort().at(0);
  if (after && before && after >= before) {
    throw new MailSearchSyntaxError("The mail search date range is empty.");
  }
  const larger = sizes("larger").sort((left, right) => left - right).at(-1);
  const smaller = sizes("smaller").sort((left, right) => left - right).at(0);
  if (larger !== undefined && smaller !== undefined && larger + 1 >= smaller) {
    throw new MailSearchSyntaxError("The mail search size range is empty.");
  }
};

const canonicalValue = (value: string, phrase = false): string =>
  phrase || /\s|["\\]/u.test(value)
    ? `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
    : value;

const canonicalCriterion = (item: MailSearchCriterion): string => {
  if (item.type === "text") {
    const value = canonicalValue(item.value, item.phrase);
    return item.field === "text" ? value : `${item.field}:${value}`;
  }
  if (item.type === "date") return `${item.boundary}:${item.date}`;
  if (item.type === "size") return `${item.boundary}:${item.bytes}`;
  if (item.type === "state") return `is:${item.state}`;
  if (item.type === "mailbox") return `in:${canonicalValue(item.value)}`;
  return "has:attachment";
};

export const parseMailSearch = (input: string): MailSearchQuery => {
  if (input.length > MAX_MAIL_SEARCH_CHARACTERS) {
    throw new MailSearchSyntaxError("The mail search is too long.");
  }
  const tokens = tokenize(input.trim());
  if (!tokens.length) throw new MailSearchSyntaxError("The mail search is empty.");
  if (tokens.length > MAX_CRITERIA) {
    throw new MailSearchSyntaxError("The mail search contains too many terms.");
  }
  const criteria = tokens.map(criterion);
  assertCompatible(criteria);
  return {
    canonical: criteria.map(canonicalCriterion).join(" "),
    criteria,
  };
};

export const serializeMailSearch = (
  criteria: readonly MailSearchCriterion[],
): string => criteria.map(canonicalCriterion).join(" ");
