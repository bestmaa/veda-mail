import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { MockMailGateway } from "@/infrastructure/providers/mock/mock-mail.gateway";
import { mockMailboxIds } from "@/infrastructure/providers/mock/mock-seed";

const labelId = id.label("veda-label-aaaqeayeaudaocajbifqydiob4");

describe("mock provider bounded label cleanup", () => {
  it("provides idempotent, resumable parity with production providers", async () => {
    const gateway = new MockMailGateway();
    const page = await gateway.listMessages({
      includePreview: true,
      limit: 10,
      mailboxId: mockMailboxIds.inbox,
      sort: "newest",
    });
    const targets = page.items.slice(0, 2);
    for (const message of targets) {
      await gateway.mutateMessage({
        labelId, messageId: message.id, type: "set-label", value: true,
      });
    }

    const first = await gateway.cleanupLabel({ labelId, limit: 1 });
    expect(first).toMatchObject({ complete: false, processed: 1, removed: 1 });
    const second = await gateway.cleanupLabel({
      cursor: first.cursor!, labelId, limit: 1,
    });
    expect(second).toEqual({ complete: true, cursor: null, processed: 1, removed: 1 });
    await expect(gateway.cleanupLabel({ labelId, limit: 1 })).resolves.toEqual({
      complete: true, cursor: null, processed: 0, removed: 0,
    });
  });
});
