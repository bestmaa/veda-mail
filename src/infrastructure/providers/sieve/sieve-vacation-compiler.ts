import "server-only";

import { createHash } from "node:crypto";

import type { VacationResponseUpdate } from "@/domain/mail/vacation";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
} from "@/domain/mail/outgoing-content-policy";
import {
  decodeOwnedSieveBody,
  encodeOwnedSieveBody,
} from "@/infrastructure/providers/sieve/sieve-owned-compiler";

const VACATION_BEGIN = "# Veda-Mail-Vacation-v1-Begin";
const VACATION_END = "# Veda-Mail-Vacation-v1-End";
const VACATION_META = "# Veda-Mail-Vacation-v1-Meta: ";
const REQUIRE = /^require \[([^\r\n]*)\];\r\n/u;

export interface SieveVacationProgram {
  readonly content: string;
  readonly requiredExtensions: readonly string[];
  readonly revision: string;
}

export class SieveVacationCompileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SieveVacationCompileError";
  }
}

const hash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("base64url");

export const emptySieveVacationRevision = (): string => hash("");
export const emptyOwnedSieveRulesRevision = (): string => hash("");

const safe = (value: string, label: string): string => {
  if (value !== value.normalize("NFKC") || hasUnpairedContentSurrogate(value) ||
      hasDisallowedContentControl(value) || /[\r\n\t\u2028\u2029]/u.test(value)) {
    throw new SieveVacationCompileError(`${label} is not canonical safe text.`);
  }
  return value;
};

const quoted = (value: string, label: string): string =>
  `"${safe(value, label).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const textLiteral = (value: string): string => {
  if (hasUnpairedContentSurrogate(value) || hasDisallowedContentControl(value) ||
      value !== value.normalize("NFKC")) {
    throw new SieveVacationCompileError("Vacation body is not canonical safe text.");
  }
  const canonical = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const stuffed = canonical.split("\n").map((line) => line.startsWith(".") ? `.${line}` : line);
  return `text:\r\n${stuffed.join("\r\n")}\r\n.\r\n`;
};

const base64Lines = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/gu)?.join("\r\n") ?? "";

const vacationMessage = (input: VacationResponseUpdate): { mime: boolean; value: string } => {
  if (!input.htmlBody) return { mime: false, value: input.textBody ?? "" };
  const boundary = `veda-${hash(`${input.textBody ?? ""}\0${input.htmlBody}`).slice(0, 24)}`;
  return {
    mime: true,
    value: [
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(input.textBody ?? "Automatic reply"),
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(input.htmlBody),
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  };
};

const metadata = (input: VacationResponseUpdate): readonly string[] => Buffer.from(JSON.stringify({
  fromDate: input.fromDate,
  htmlBody: input.htmlBody,
  isEnabled: input.isEnabled,
  subject: input.subject,
  textBody: input.textBody,
  toDate: input.toDate,
}), "utf8").toString("base64url").match(/.{1,512}/gu) ?? [];

const stripVacation = (body: string): { rules: string; vacation: string | null } => {
  const begin = body.indexOf(`${VACATION_BEGIN}\r\n`);
  if (begin < 0) return { rules: body, vacation: null };
  const endMarker = `\r\n${VACATION_END}\r\n`;
  const end = body.indexOf(endMarker, begin);
  if (end < 0 || body.indexOf(`${VACATION_BEGIN}\r\n`, begin + 1) >= 0 ||
      body.indexOf(endMarker, end + endMarker.length) >= 0) {
    throw new SieveVacationCompileError("The owned vacation block is ambiguous.");
  }
  return {
    rules: `${body.slice(0, begin)}${body.slice(end + endMarker.length)}`,
    vacation: body.slice(begin, end + endMarker.length),
  };
};

const requirements = (rules: string): string[] => {
  const match = REQUIRE.exec(rules);
  if (!match) return [];
  const values = [...match[1]!.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gu)]
    .map((item) => item[1]!.replaceAll('\\"', '"').replaceAll("\\\\", "\\"));
  if (!values.length && match[1]!.trim()) {
    throw new SieveVacationCompileError("The owned require statement is invalid.");
  }
  return values;
};

const withRequirements = (rules: string, required: readonly string[]): string => {
  const without = rules.replace(REQUIRE, "");
  return required.length
    ? `require [${required.map((item) => quoted(item, "Sieve extension")).join(", ")}];\r\n${without}`
    : without;
};

const ruleRequirements = (rules: string): readonly string[] =>
  requirements(rules).filter((item) => !["date", "relational", "vacation"].includes(item));

const vacationBlock = (input: VacationResponseUpdate): {
  block: string | null;
  extensions: readonly string[];
} => {
  if (!input.isEnabled) return { block: null, extensions: [] };
  const message = input.textBody ?? input.htmlBody;
  if (!message) throw new SieveVacationCompileError("An enabled vacation response needs a body.");
  const tests = [
    ...(input.fromDate ? [`currentdate :value "ge" "iso8601" ${quoted(input.fromDate, "Start date")}`] : []),
    ...(input.toDate ? [`currentdate :value "lt" "iso8601" ${quoted(input.toDate, "End date")}`] : []),
  ];
  const rendered = vacationMessage(input);
  const command = `vacation :days 1${input.subject ? ` :subject ${quoted(input.subject, "Subject")}` : ""}${rendered.mime ? " :mime" : ""} ${textLiteral(rendered.value)};`;
  const lines = [VACATION_BEGIN, ...metadata(input).map((part) => `${VACATION_META}${part}`)];
  if (tests.length) lines.push(`if allof(${tests.join(", ")}) {`, `  ${command}`, "}");
  else lines.push(command);
  lines.push(VACATION_END);
  return {
    block: `${lines.join("\r\n")}\r\n`,
    extensions: ["vacation", ...(tests.length ? ["date", "relational"] : [])],
  };
};

export const ownedSieveVacationBlock = (ownedContent: string): string | null => {
  const body = decodeOwnedSieveBody(ownedContent);
  if (body === null) throw new SieveVacationCompileError("The Sieve script is not owned by this installation.");
  return stripVacation(body).vacation;
};

export const ownedSieveRulesRevision = (ownedContent: string): string => {
  const body = decodeOwnedSieveBody(ownedContent);
  if (body === null) throw new SieveVacationCompileError("The Sieve script is not owned by this installation.");
  const rules = stripVacation(body).rules;
  return hash(withRequirements(rules, ruleRequirements(rules)));
};

export const composeOwnedSieveVacation = (
  ownedContent: string,
  input: VacationResponseUpdate,
): SieveVacationProgram => {
  const body = decodeOwnedSieveBody(ownedContent);
  if (body === null) throw new SieveVacationCompileError("The Sieve script is not owned by this installation.");
  const current = stripVacation(body);
  const vacation = vacationBlock(input);
  const required = [...new Set([
    ...ruleRequirements(current.rules),
    ...vacation.extensions,
  ])].sort();
  const rules = withRequirements(current.rules, required);
  const combined = `${rules}${vacation.block ?? ""}`;
  return {
    content: encodeOwnedSieveBody(combined),
    requiredExtensions: required,
    revision: hash(vacation.block ?? ""),
  };
};

export const preserveOwnedSieveVacation = (
  nextOwnedRules: string,
  existingOwnedContent: string | null,
): SieveVacationProgram => {
  const nextBody = decodeOwnedSieveBody(nextOwnedRules);
  if (nextBody === null) throw new SieveVacationCompileError("The generated rules script is not owned.");
  const existingBody = existingOwnedContent === null ? null : decodeOwnedSieveBody(existingOwnedContent);
  if (existingOwnedContent !== null && existingBody === null) {
    throw new SieveVacationCompileError("The existing Sieve script is not owned.");
  }
  const existing = existingBody === null ? { vacation: null } : stripVacation(existingBody);
  const next = stripVacation(nextBody);
  const vacationExtensions = existing.vacation
    ? ["vacation", ...(existing.vacation.includes("currentdate") ? ["date", "relational"] : [])]
    : [];
  const required = [...new Set([
    ...ruleRequirements(next.rules),
    ...vacationExtensions,
  ])].sort();
  const combined = `${withRequirements(next.rules, required)}${existing.vacation ?? ""}`;
  return { content: encodeOwnedSieveBody(combined), requiredExtensions: required,
    revision: hash(existing.vacation ?? "") };
};
