const encoder = new TextEncoder();

export const VCARD_LIMITS = {
  cards: 1_000,
  categories: 64,
  emails: 32,
  inputBytes: 1_048_576,
  properties: 256,
  unfoldedLineBytes: 8_192,
  valueBytes: 2_048,
} as const;

export interface VCardEmail {
  readonly address: string;
  readonly preferred: boolean;
  readonly types: readonly string[];
}

export interface VCardStructuredName {
  readonly additional: string;
  readonly family: string;
  readonly given: string;
  readonly prefix: string;
  readonly suffix: string;
}

export interface VCardContact {
  readonly categories: readonly string[];
  readonly displayName: string;
  readonly emails: readonly VCardEmail[];
  readonly organization?: string;
  readonly structuredName?: VCardStructuredName;
  readonly uid?: string;
}

export class VCardError extends Error {
  public constructor(message: string, public readonly line?: number) {
    super(line ? `vCard line ${line}: ${message}` : `vCard: ${message}`);
    this.name = "VCardError";
  }
}

const bytes = (value: string) => encoder.encode(value).byteLength;
const malformedUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const safeToken = /^[a-z0-9-]{1,32}$/iu;
const ignoredPayload = new Set(["AGENT", "KEY", "LOGO", "PHOTO", "URL"]);
const hasUnsafeText = (value: string): boolean => [...value].some((scalar) => {
  const code = scalar.codePointAt(0)!;
  return code <= 31 || code === 127 || code === 0x2028 || code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
});

const assertBoundedText = (value: string, label: string, line?: number): string => {
  const trimmed = value.trim();
  if (!trimmed || bytes(trimmed) > VCARD_LIMITS.valueBytes || hasUnsafeText(trimmed)) {
    throw new VCardError(`${label} is empty, unsafe, or too long.`, line);
  }
  return trimmed;
};

const unescapeText = (input: string, line: number): string => {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index]!;
    if (current !== "\\") { output += current; continue; }
    const next = input[++index];
    if (next === undefined) throw new VCardError("A value ends in an escape.", line);
    if (next === "n" || next === "N") output += "\n";
    else if (next === "\\" || next === "," || next === ";") output += next;
    else throw new VCardError("A value contains an invalid escape.", line);
  }
  return output;
};

const splitEscaped = (input: string, separator: string): string[] => {
  const result: string[] = [];
  let start = 0, escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]!;
    if (!escaped && value === separator) { result.push(input.slice(start, index)); start = index + 1; }
    escaped = !escaped && value === "\\";
    if (value !== "\\") escaped = false;
  }
  result.push(input.slice(start));
  return result;
};

interface LogicalLine { readonly number: number; readonly value: string }
const unfold = (input: string): readonly LogicalLine[] => {
  if (malformedUnicode.test(input)) throw new VCardError("Input is not valid UTF-8 text.");
  if (bytes(input) > VCARD_LIMITS.inputBytes) throw new VCardError("Input is too large.");
  const normalized = input.replaceAll("\r\n", "\n");
  if (normalized.includes("\r")) throw new VCardError("Bare carriage returns are not allowed.");
  const logical: LogicalLine[] = [];
  for (const [offset, physical] of normalized.split("\n").entries()) {
    if (physical.startsWith(" ") || physical.startsWith("\t")) {
      const previous = logical.at(-1);
      if (!previous) throw new VCardError("Unexpected folded continuation.", offset + 1);
      logical[logical.length - 1] = { number: previous.number, value: previous.value + physical.slice(1) };
    } else logical.push({ number: offset + 1, value: physical });
    if (hasUnsafeText(logical.at(-1)!.value)) {
      throw new VCardError("Property contains unsafe control text.", logical.at(-1)!.number);
    }
    if (bytes(logical.at(-1)!.value) > VCARD_LIMITS.unfoldedLineBytes) {
      throw new VCardError("Unfolded property is too long.", logical.at(-1)!.number);
    }
  }
  return logical;
};

interface Property { readonly name: string; readonly params: Map<string, string[]>; readonly value: string }
const parseProperty = ({ number, value }: LogicalLine): Property => {
  let quoted = false, colon = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    if (!quoted && value[index] === ":") { colon = index; break; }
  }
  if (quoted || colon < 1) throw new VCardError("Malformed content line.", number);
  const sections = value.slice(0, colon).split(";");
  const name = sections.shift()!.toUpperCase();
  if (!/^[A-Z][A-Z0-9-]{0,31}$/u.test(name)) throw new VCardError("Invalid property name.", number);
  const params = new Map<string, string[]>();
  for (const section of sections) {
    const equals = section.indexOf("=");
    const key = (equals < 0 ? "TYPE" : section.slice(0, equals)).toUpperCase();
    let raw = equals < 0 ? section : section.slice(equals + 1);
    if (!safeToken.test(key)) throw new VCardError("Invalid property parameter.", number);
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
    if (!raw || bytes(raw) > 512 || hasUnsafeText(raw) || /[";]/u.test(raw)) {
      throw new VCardError("Unsafe property parameter.", number);
    }
    params.set(key, [...(params.get(key) ?? []), ...raw.split(",")]);
  }
  return { name, params, value: value.slice(colon + 1) };
};

const emailValue = (property: Property, line: number): VCardEmail => {
  if (property.params.has("ENCODING") || property.params.get("VALUE")?.some((v) => v.toLowerCase() === "uri")) {
    throw new VCardError("Encoded or URI email values are not supported.", line);
  }
  const address = assertBoundedText(unescapeText(property.value, line), "Email", line);
  if (/\s/u.test(address) || address.toLowerCase().startsWith("mailto:") ||
      address.split("@").length !== 2 || address.startsWith("@") || address.endsWith("@") || address.length > 320) {
    throw new VCardError("Invalid email address.", line);
  }
  const rawTypes = property.params.get("TYPE") ?? [];
  const types = [...new Set(rawTypes.map((type) => type.toLowerCase()).filter((type) => type !== "pref"))].sort();
  if (types.length > 8 || types.some((type) => !safeToken.test(type))) throw new VCardError("Invalid email type.", line);
  return { address, preferred: rawTypes.some((type) => type.toLowerCase() === "pref") || property.params.get("PREF")?.includes("1") === true, types };
};

interface MutableCard { categories: string[]; displayName?: string; emails: VCardEmail[]; organization?: string; structuredName?: VCardStructuredName; uid?: string; version?: string }
export const importVCards = (input: string): readonly VCardContact[] => {
  const cards: VCardContact[] = [];
  let card: MutableCard | undefined, properties = 0;
  for (const logical of unfold(input)) {
    if (!logical.value) continue;
    const property = parseProperty(logical);
    if (property.name === "BEGIN") {
      if (card || property.value.toUpperCase() !== "VCARD") throw new VCardError("Unexpected BEGIN.", logical.number);
      if (cards.length >= VCARD_LIMITS.cards) throw new VCardError("Too many cards.", logical.number);
      card = { categories: [], emails: [] }; properties = 0; continue;
    }
    if (!card) throw new VCardError("Property outside a card.", logical.number);
    if (++properties > VCARD_LIMITS.properties) throw new VCardError("Too many properties.", logical.number);
    if (property.name === "END") {
      if (property.value.toUpperCase() !== "VCARD" || !card.version || !card.displayName) throw new VCardError("Card is incomplete.", logical.number);
      if (!card.emails.length) throw new VCardError("Card has no email address.", logical.number);
      cards.push({ categories: [...new Set(card.categories)].sort(), displayName: card.displayName, emails: card.emails, ...(card.organization ? { organization: card.organization } : {}), ...(card.structuredName ? { structuredName: card.structuredName } : {}), ...(card.uid ? { uid: card.uid } : {}) });
      card = undefined; continue;
    }
    if (ignoredPayload.has(property.name)) continue;
    if (property.params.has("ENCODING")) throw new VCardError("Encoded values are not supported.", logical.number);
    const text = () => assertBoundedText(unescapeText(property.value, logical.number), property.name, logical.number);
    if (property.name === "VERSION") { if (card.version || !["3.0", "4.0"].includes(property.value)) throw new VCardError("Only vCard 3.0 and 4.0 are supported.", logical.number); card.version = property.value; }
    else if (property.name === "FN") { if (card.displayName) throw new VCardError("Duplicate FN.", logical.number); card.displayName = text(); }
    else if (property.name === "N") { const values = splitEscaped(property.value, ";"); if (card.structuredName || values.length > 5) throw new VCardError("Invalid N property.", logical.number); const names = [...values, "", "", "", "", ""].slice(0, 5).map((v) => v ? assertBoundedText(unescapeText(v, logical.number), "Name", logical.number) : ""); card.structuredName = { family: names[0]!, given: names[1]!, additional: names[2]!, prefix: names[3]!, suffix: names[4]! }; }
    else if (property.name === "EMAIL") { const email = emailValue(property, logical.number); const existing = card.emails.find((item) => item.address.toLowerCase() === email.address.toLowerCase()); if (existing) { const index = card.emails.indexOf(existing); card.emails[index] = { address: existing.address, preferred: existing.preferred || email.preferred, types: [...new Set([...existing.types, ...email.types])].sort() }; } else { if (card.emails.length >= VCARD_LIMITS.emails) throw new VCardError("Too many email addresses.", logical.number); card.emails.push(email); } }
    else if (property.name === "ORG") { if (card.organization) throw new VCardError("Duplicate ORG.", logical.number); card.organization = text(); }
    else if (property.name === "CATEGORIES") { for (const value of splitEscaped(property.value, ",")) { if (card.categories.length >= VCARD_LIMITS.categories) throw new VCardError("Too many categories.", logical.number); card.categories.push(assertBoundedText(unescapeText(value, logical.number), "Category", logical.number)); } }
    else if (property.name === "UID") { if (card.uid) throw new VCardError("Duplicate UID.", logical.number); card.uid = text(); }
  }
  if (card) throw new VCardError("Card is missing END:VCARD.");
  if (!cards.length) throw new VCardError("No vCards were found.");
  return cards;
};

const escapeText = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,");
const fold = (line: string): string => { const chunks: string[] = []; let chunk = ""; for (const scalar of line) { const limit = chunks.length ? 74 : 75; if (chunk && bytes(chunk + scalar) > limit) { chunks.push(chunk); chunk = scalar; } else chunk += scalar; } chunks.push(chunk); return chunks.join("\r\n "); };
const exportValue = (value: string, label: string): string => escapeText(assertBoundedText(value, label));
export const exportVCards = (contacts: readonly VCardContact[]): string => {
  if (!contacts.length || contacts.length > VCARD_LIMITS.cards) throw new VCardError("Invalid card count.");
  const output: string[] = [];
  for (const contact of contacts) {
    if (!contact.emails.length || contact.emails.length > VCARD_LIMITS.emails) throw new VCardError("A contact needs a bounded email list.");
    const lines = ["BEGIN:VCARD", "VERSION:4.0", `FN:${exportValue(contact.displayName, "FN")}`];
    const name = contact.structuredName;
    if (name) lines.push(`N:${[name.family, name.given, name.additional, name.prefix, name.suffix].map((value) => value ? exportValue(value, "Name") : "").join(";")}`);
    if (contact.organization) lines.push(`ORG:${exportValue(contact.organization, "ORG")}`);
    const canonicalEmails = new Map<string, VCardEmail>();
    for (const email of contact.emails) {
      const valid = emailValue({ name: "EMAIL", params: new Map([["TYPE", [...email.types, ...(email.preferred ? ["pref"] : [])]]]), value: email.address }, 0);
      const key = valid.address.toLowerCase(), existing = canonicalEmails.get(key);
      canonicalEmails.set(key, existing ? { address: existing.address, preferred: existing.preferred || valid.preferred, types: [...new Set([...existing.types, ...valid.types])].sort() } : valid);
    }
    for (const valid of [...canonicalEmails.values()].sort((a, b) => a.address.localeCompare(b.address, "en", { sensitivity: "base" }))) {
      const params = [...valid.types].sort().map((type) => `TYPE=${type.toUpperCase()}`); if (valid.preferred) params.push("PREF=1");
      lines.push(`EMAIL${params.length ? `;${params.join(";")}` : ""}:${valid.address}`);
    }
    const categories = [...new Set(contact.categories.map((value) => exportValue(value, "Category")))].sort();
    if (categories.length > VCARD_LIMITS.categories) throw new VCardError("Too many categories.");
    if (categories.length) lines.push(`CATEGORIES:${categories.join(",")}`);
    if (contact.uid) lines.push(`UID:${exportValue(contact.uid, "UID")}`);
    lines.push("END:VCARD"); output.push(lines.map(fold).join("\r\n"));
  }
  const result = `${output.join("\r\n")}\r\n`;
  if (bytes(result) > VCARD_LIMITS.inputBytes) throw new VCardError("Export is too large.");
  return result;
};
