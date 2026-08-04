import { describe, expect, it, vi } from "vitest";

import { markerUids } from "@/infrastructure/providers/imap-smtp/imap-snooze-marker";

describe("IMAP snooze marker recovery", () => {
  it("fails closed when a marker has multiple matches", async () => {
    const client = { search: vi.fn(async () => [1, 2]) };
    await expect(markerUids(client as never, "veda-snooze-test"))
      .rejects.toThrow("ambiguous");
  });
});
