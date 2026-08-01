import { beforeEach, describe, expect, it } from "vitest";

import type { MailWorkspace, MessageSummary } from "@/domain/mail/mail";
import {
  api,
  inboxId,
  message,
  refresh,
  render,
  resetMailDataModelHarness,
  settle,
  workspace,
} from "./mail-data-model-session-scope.test-support";

const page = (
  scope: string,
  items: readonly MessageSummary[],
  nextCursor: string | null,
  total = items.length,
): MailWorkspace => ({
  ...workspace(scope),
  mailboxes: [
    {
      ...workspace(scope).mailboxes[0]!,
      total,
    },
  ],
  messages: { items, nextCursor, total },
});

beforeEach(resetMailDataModelHarness);

describe("mail data cursor pagination", () => {
  it("appends a deduplicated page and preserves the open message", async () => {
    const first = message("message-a");
    const second = message("message-b");
    api.getWorkspace.mockResolvedValueOnce(page("scope-a", [first], "50", 2));
    let model = render();
    await refresh(model);
    model = render();

    api.getMessage.mockResolvedValueOnce(first);
    await model.selectMessage("message-a");
    model = render();
    api.getWorkspace.mockResolvedValueOnce(
      page("scope-a", [first, second], null, 2),
    );

    await model.onLoadMore();
    model = render();

    expect(api.getWorkspace).toHaveBeenLastCalledWith(
      {
        cursor: "50",
        mailboxId: inboxId,
        showPreview: true,
        sort: "newest",
      },
      "scope-a",
    );
    expect(model.workspace?.messages.items.map((item) => item.id)).toEqual([
      "message-a",
      "message-b",
    ]);
    expect(model.selectedMessage?.id).toBe("message-a");
    expect(model.workspace?.messages.nextCursor).toBeNull();
    expect(model.isLoadingMore).toBe(false);
    expect(model.loadMoreError).toBeNull();
  });

  it("coalesces duplicate load-more requests while a page is pending", async () => {
    const first = message("message-a");
    api.getWorkspace.mockResolvedValueOnce(page("scope-a", [first], "50", 2));
    let model = render();
    await refresh(model);
    model = render();
    const pending = Promise.withResolvers<MailWorkspace>();
    api.getWorkspace.mockReturnValueOnce(pending.promise);

    const firstLoad = model.onLoadMore();
    const duplicateLoad = model.onLoadMore();

    expect(api.getWorkspace).toHaveBeenCalledTimes(2);
    pending.resolve(page("scope-a", [message("message-b")], null, 2));
    await Promise.all([firstLoad, duplicateLoad]);
    expect(render().workspace?.messages.items).toHaveLength(2);
  });

  it("ignores a stale page after a root mailbox refresh wins", async () => {
    const first = message("message-a");
    api.getWorkspace.mockResolvedValueOnce(page("scope-a", [first], "50", 3));
    let model = render();
    await refresh(model);
    model = render();
    const stalePage = Promise.withResolvers<MailWorkspace>();
    api.getWorkspace.mockReturnValueOnce(stalePage.promise);
    const pendingLoad = model.onLoadMore();

    api.getWorkspace.mockResolvedValueOnce(
      page("scope-a", [message("message-fresh")], null, 1),
    );
    await refresh(model);
    stalePage.resolve(page("scope-a", [message("message-stale")], null, 3));
    await pendingLoad;
    await settle();

    expect(render().workspace?.messages.items.map((item) => item.id)).toEqual([
      "message-fresh",
    ]);
  });

  it("exposes a recoverable page error and retries the same cursor", async () => {
    const first = message("message-a");
    api.getWorkspace.mockResolvedValueOnce(page("scope-a", [first], "50", 2));
    let model = render();
    await refresh(model);
    model = render();
    api.getWorkspace.mockRejectedValueOnce(new Error("Provider timed out."));

    await model.onLoadMore();
    model = render();
    expect(model.loadMoreError).toBe("Provider timed out.");

    api.getWorkspace.mockResolvedValueOnce(
      page("scope-a", [message("message-b")], null, 2),
    );
    await model.onLoadMore();
    model = render();

    expect(model.loadMoreError).toBeNull();
    expect(model.workspace?.messages.items).toHaveLength(2);
  });
});
