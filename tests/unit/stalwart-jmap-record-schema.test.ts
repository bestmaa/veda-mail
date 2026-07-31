import { describe, expect, it, vi } from "vitest";

import { jmapDraftEmailSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import {
  jmapIdBooleanRecordSchema,
  jmapKeywordBooleanRecordSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-record.schema";
import { jmapEmailSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";

const recordWith = (count: number): Readonly<Record<string, boolean>> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`key-${index}`, true]),
  );

const sharedEmail = (keywords: Readonly<Record<string, boolean>>) => ({
  hasAttachment: false,
  id: "email",
  keywords,
  mailboxIds: { inbox: true },
  preview: "",
  receivedAt: "2026-07-31T10:00:00.000Z",
  size: 0,
  subject: "",
  threadId: "thread",
});

const draftEmail = (mailboxIds: Readonly<Record<string, boolean>>) => ({
  hasAttachment: false,
  id: "draft",
  keywords: { $draft: true },
  mailboxIds,
  receivedAt: "2026-07-31T10:00:00.000Z",
  subject: "",
});

describe("bounded JMAP boolean records", () => {
  it("accepts boundary-sized records and keyword names", () => {
    expect(
      jmapKeywordBooleanRecordSchema.safeParse({
        $draft: true,
        "veda-compose-5d91bdc1-7c39-465e-95c6-dd937398cc4f": true,
      }).success,
    ).toBe(true);
    expect(
      jmapKeywordBooleanRecordSchema.safeParse(recordWith(1_024)).success,
    ).toBe(true);
    expect(
      jmapKeywordBooleanRecordSchema.safeParse({ ["a".repeat(255)]: true })
        .success,
    ).toBe(true);
  });

  it("rejects excessive records in shared and draft schemas", () => {
    const excessive = recordWith(1_025);
    expect(jmapKeywordBooleanRecordSchema.safeParse(excessive).success).toBe(
      false,
    );
    expect(jmapEmailSchema.safeParse(sharedEmail(excessive)).success).toBe(
      false,
    );
    expect(jmapDraftEmailSchema.safeParse(draftEmail(excessive)).success).toBe(
      false,
    );
  });

  it("enforces the lowercase ASCII JMAP keyword grammar", () => {
    expect(
      jmapKeywordBooleanRecordSchema.safeParse({ "allowed[}": true }).success,
    ).toBe(true);
    for (const key of [
      "",
      "a".repeat(256),
      "Uppercase",
      "bad key",
      "bad\nkey",
      "\u{1F600}",
      "bad\uD800",
      ...['"', "%", "(", ")", "*", "\\", "]", "{"],
    ]) {
      expect(
        jmapKeywordBooleanRecordSchema.safeParse({ [key]: true }).success,
      ).toBe(false);
    }
  });

  it("enforces opaque ids before allocating a UTF-8 buffer", () => {
    expect(
      jmapIdBooleanRecordSchema.safeParse({ ["A_".padEnd(255, "a")]: true })
        .success,
    ).toBe(true);
    for (const key of ["", "a".repeat(256), "$draft", "bad/id", "\u00e9"]) {
      expect(jmapIdBooleanRecordSchema.safeParse({ [key]: true }).success).toBe(
        false,
      );
    }
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    expect(
      jmapIdBooleanRecordSchema.safeParse({ ["a".repeat(1_000_000)]: true })
        .success,
    ).toBe(false);
    expect(encode).not.toHaveBeenCalled();
    encode.mockRestore();
  });
});
