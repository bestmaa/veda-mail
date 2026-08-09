import "server-only";

import { z } from "zod";

import {
  MAX_VACATION_BODY_CHARACTERS,
  MAX_VACATION_SUBJECT_CHARACTERS,
  isCanonicalVacationUtcDate,
  type VacationResponseUpdate,
} from "@/domain/mail/vacation";

const nullableText = (maximum: number) => z.string().max(maximum).nullable();
const utcDate = z.string().refine(isCanonicalVacationUtcDate).nullable();

const schema = z.object({
  expectedRevision: z.string().min(1).max(1_024),
  fromDate: utcDate,
  htmlBody: nullableText(MAX_VACATION_BODY_CHARACTERS),
  isEnabled: z.boolean(),
  subject: nullableText(MAX_VACATION_SUBJECT_CHARACTERS),
  textBody: nullableText(MAX_VACATION_BODY_CHARACTERS),
  toDate: utcDate,
}).strict().superRefine((value, context) => {
  if (value.fromDate && value.toDate && value.fromDate >= value.toDate) {
    context.addIssue({ code: "custom", message: "Vacation end date must follow its start date." });
  }
  if (value.isEnabled && !value.textBody?.trim() && !value.htmlBody?.trim()) {
    context.addIssue({ code: "custom", message: "An enabled vacation response needs a message." });
  }
});

export const parseVacationResponseUpdate = (value: unknown): VacationResponseUpdate =>
  schema.parse(value);
