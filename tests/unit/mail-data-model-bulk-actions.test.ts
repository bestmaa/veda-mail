import { beforeEach, describe, expect, it } from "vitest";

import type { MailWorkspace } from "@/domain/mail/mail";
import {
  api,
  message,
  refresh,
  render,
  resetMailDataModelHarness,
  settle,
  workspace,
} from "./mail-data-model-session-scope.test-support";

const populated = (scope = "scope-a"): MailWorkspace => ({
  ...workspace(scope),
  messages: {
    items: [message("message-a"), message("message-b")],
    nextCursor: null,
    total: 2,
  },
});

beforeEach(resetMailDataModelHarness);

describe("mail data bulk actions", () => {
  it("keeps only provider failures selected and refreshes successes", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    model.bulk.toggle(snapshot.messages.items[0]!.id);
    model = render();
    model.bulk.toggle(snapshot.messages.items[1]!.id);
    model = render();
    api.mutateMessages.mockResolvedValueOnce({
      failed: [snapshot.messages.items[1]!.id],
      succeeded: [snapshot.messages.items[0]!.id],
    });
    api.getWorkspace.mockResolvedValueOnce(snapshot);

    await model.bulk.mutate({ type: "set-read", value: true });
    await settle();
    model = render();

    expect(api.mutateMessages).toHaveBeenCalledWith(
      {
        messageIds: ["message-a", "message-b"],
        type: "set-read",
        value: true,
      },
      "scope-a",
    );
    expect([...model.bulk.selectedIds]).toEqual(["message-b"]);
    expect(model.bulk.status).toBe(
      "1 updated; 1 failed and remain selected.",
    );
    expect(api.getWorkspace).toHaveBeenCalledTimes(2);
  });

  it("coalesces duplicate actions while one batch is pending", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    model.bulk.toggle(snapshot.messages.items[0]!.id);
    model = render();
    const pending = Promise.withResolvers<{
      failed: never[];
      succeeded: readonly typeof snapshot.messages.items[0]["id"][];
    }>();
    api.mutateMessages.mockReturnValueOnce(pending.promise);

    const first = model.bulk.mutate({ type: "archive" });
    const duplicate = model.bulk.mutate({ type: "archive" });

    expect(api.mutateMessages).toHaveBeenCalledOnce();
    pending.resolve({
      failed: [],
      succeeded: [snapshot.messages.items[0]!.id],
    });
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    await Promise.all([first, duplicate]);
  });

  it("retains the selection and exposes a retryable request error", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    model.bulk.toggle(snapshot.messages.items[0]!.id);
    model = render();
    api.mutateMessages.mockRejectedValueOnce(new Error("Provider timed out."));

    await model.bulk.mutate({ type: "delete" });
    model = render();

    expect([...model.bulk.selectedIds]).toEqual(["message-a"]);
    expect(model.bulk.error).toBe("Provider timed out.");
  });
});
