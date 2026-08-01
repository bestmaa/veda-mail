import { describe, expect, it } from "vitest";

import type { LabelOwner } from "@/domain/mail/label";
import { id } from "@/domain/shared/brand";
import { withLabelOperation } from "@/server/labels/label-operation-lock";

const owner: LabelOwner = {
  email: "member@example.com",
  providerId: "mock",
};
const labelId = id.label("veda-label-aaaqeayeaudaocajbifqydiob4");

describe("label operation lock", () => {
  it("serializes mutation and deletion work for the same owner and label", async () => {
    const events: string[] = [];
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const mutation = withLabelOperation(owner, labelId, async () => {
      events.push("mutation-start");
      await mutationGate;
      events.push("mutation-end");
    });
    await Promise.resolve();
    const deletion = withLabelOperation(owner, labelId, async () => {
      events.push("deletion");
    });

    await Promise.resolve();
    expect(events).toEqual(["mutation-start"]);
    releaseMutation();
    await Promise.all([mutation, deletion]);
    expect(events).toEqual(["mutation-start", "mutation-end", "deletion"]);
  });

  it("continues the queue after a failed operation", async () => {
    await expect(withLabelOperation(owner, labelId, async () => {
      throw new Error("provider failed");
    })).rejects.toThrow("provider failed");
    await expect(withLabelOperation(owner, labelId, async () => "ok"))
      .resolves.toBe("ok");
  });
});
