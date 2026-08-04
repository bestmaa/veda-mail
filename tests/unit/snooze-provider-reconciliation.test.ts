import { describe, expect, it } from "vitest";

import { classifyImapSnoozeState } from "@/infrastructure/providers/imap-smtp/imap-snooze-plan";
import { classifyStalwartSnoozeState } from "@/infrastructure/providers/stalwart-jmap/stalwart-snooze-schema";

describe("provider snooze reconciliation", () => {
  it.each([
    [true, false, "visible"],
    [false, true, "snoozed"],
    [true, true, "visible"],
    [false, false, "deleted"],
  ] as const)("classifies JMAP source=%s target=%s", (source, target, expected) => {
    expect(classifyStalwartSnoozeState(source, target)).toBe(expected);
  });

  it.each([
    [true, false, "visible"],
    [false, true, "snoozed"],
    [false, false, "deleted"],
  ] as const)("classifies IMAP source=%s target=%s", (source, target, expected) => {
    expect(classifyImapSnoozeState(source, target)).toBe(expected);
  });

  it("fails closed for an IMAP duplicate in source and target", () => {
    expect(() => classifyImapSnoozeState(true, true)).toThrow("both source and target");
  });
});
