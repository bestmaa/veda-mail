import "server-only";

import { createHash } from "node:crypto";

import {
  isCanonicalVacationUtcDate,
  MAX_VACATION_BODY_CHARACTERS,
  MAX_VACATION_SUBJECT_CHARACTERS,
  type VacationResponse,
} from "@/domain/mail/vacation";
import {
  emptySieveVacationRevision,
  ownedSieveVacationBlock,
  SieveVacationCompileError,
} from "@/infrastructure/providers/sieve/sieve-vacation-compiler";

const VACATION_META = "# Veda-Mail-Vacation-v1-Meta: ";
const hash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("base64url");
const invalid = (): never => {
  throw new SieveVacationCompileError("The owned vacation metadata is invalid.");
};

const metadata = (vacation: string): Record<string, unknown> => {
  const parts = vacation.split("\r\n").filter((item) => item.startsWith(VACATION_META));
  if (!parts.length) {
    throw new SieveVacationCompileError("The owned vacation metadata is missing.");
  }
  try {
    const encoded = parts.map((part) => part.slice(VACATION_META.length)).join("");
    if (!/^[A-Za-z0-9_-]{1,100000}$/u.test(encoded)) return invalid();
    const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    return value as Record<string, unknown>;
  } catch {
    return invalid();
  }
};

export const readOwnedSieveVacation = (ownedContent: string): VacationResponse => {
  const vacation = ownedSieveVacationBlock(ownedContent);
  if (!vacation) return {
    fromDate: null, htmlBody: null, isEnabled: false,
    revision: emptySieveVacationRevision(), subject: null, textBody: null, toDate: null,
  };
  const item = metadata(vacation);
  const expected = ["fromDate", "htmlBody", "isEnabled", "subject", "textBody", "toDate"];
  if (Object.keys(item).sort().join("\0") !== expected.sort().join("\0")) return invalid();
  const nullableString = (key: string): string | null => {
    const candidate = item[key];
    if (candidate === null) return null;
    return typeof candidate === "string" ? candidate : invalid();
  };
  if (item["isEnabled"] !== true) return invalid();
  const fromDate = nullableString("fromDate");
  const htmlBody = nullableString("htmlBody");
  const subject = nullableString("subject");
  const textBody = nullableString("textBody");
  const toDate = nullableString("toDate");
  if ((fromDate && !isCanonicalVacationUtcDate(fromDate)) ||
      (toDate && !isCanonicalVacationUtcDate(toDate)) ||
      (fromDate && toDate && fromDate >= toDate) ||
      (subject?.length ?? 0) > MAX_VACATION_SUBJECT_CHARACTERS ||
      (textBody?.length ?? 0) > MAX_VACATION_BODY_CHARACTERS ||
      (htmlBody?.length ?? 0) > MAX_VACATION_BODY_CHARACTERS ||
      (!textBody?.trim() && !htmlBody?.trim())) return invalid();
  return { fromDate, htmlBody, isEnabled: true, revision: hash(vacation),
    subject, textBody, toDate };
};
