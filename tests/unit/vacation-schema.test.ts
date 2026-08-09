import { describe, expect, it } from "vitest";

import { parseVacationResponseUpdate } from "@/server/vacation/vacation-schema";

const valid = {
  expectedRevision: "state-1",
  fromDate: "2026-08-10T00:00:00Z",
  htmlBody: null,
  isEnabled: true,
  subject: "Out of office",
  textBody: "I will reply when I return.",
  toDate: "2026-08-12T00:00:00Z",
};

describe("vacation response input", () => {
  it("accepts a bounded canonical update", () => {
    expect(parseVacationResponseUpdate(valid)).toEqual(valid);
  });

  it("rejects unknown fields, non-UTC dates, and reversed windows", () => {
    expect(() => parseVacationResponseUpdate({ ...valid, extra: true })).toThrow();
    expect(() => parseVacationResponseUpdate({ ...valid,
      fromDate: "2026-08-10T00:00" })).toThrow();
    expect(() => parseVacationResponseUpdate({ ...valid,
      fromDate: "2026-99-40T25:61:61Z" })).toThrow();
    expect(() => parseVacationResponseUpdate({ ...valid,
      toDate: "2026-08-09T00:00:00Z" })).toThrow();
  });

  it("requires message content only when enabled", () => {
    expect(() => parseVacationResponseUpdate({ ...valid,
      htmlBody: null, textBody: "" })).toThrow();
    expect(parseVacationResponseUpdate({ ...valid,
      htmlBody: null, isEnabled: false, textBody: null })).toMatchObject({
      isEnabled: false,
    });
  });
});
