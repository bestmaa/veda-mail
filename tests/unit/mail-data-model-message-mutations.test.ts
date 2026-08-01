import { beforeEach, describe, expect, it } from "vitest";

import type { MailWorkspace } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  api,
  message,
  refresh,
  render,
  resetMailDataModelHarness,
  settle,
  workspace,
} from "./mail-data-model-session-scope.test-support";

const populated = (): MailWorkspace => ({
  ...workspace("scope-a"),
  messages: { items: [message()], nextCursor: null, total: 1 },
});

const archiveId = id.mailbox("archive");
const archiveWorkspace = (): MailWorkspace => {
  const snapshot = workspace("scope-a");
  return {
    ...snapshot,
    mailboxes: [
      ...snapshot.mailboxes,
      {
        color: "#475569",
        id: archiveId,
        name: "Archive",
        parentId: null,
        role: "archive",
        rights: { mayCreateChild: false, mayDelete: false, mayRename: false },
        sortOrder: 1,
        total: 0,
        unread: 0,
      },
    ],
  };
};

beforeEach(resetMailDataModelHarness);

describe("selected message optimistic mutations", () => {
  it("projects star state in both reader and list, then rolls back rejection", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    api.getMessage.mockResolvedValueOnce(message());
    await model.selectMessage("message-a");
    model = render();
    const pending = Promise.withResolvers<{
      failed: readonly [typeof snapshot.messages.items[0]["id"]];
      succeeded: readonly [];
    }>();
    api.mutateMessages.mockReturnValueOnce(pending.promise);

    model.toggleStar();
    model = render();
    expect(model.selectedMessage?.isStarred).toBe(true);
    expect(model.workspace?.messages.items[0]?.isStarred).toBe(true);
    expect(model.isReaderMutating).toBe(true);

    pending.resolve({ failed: [snapshot.messages.items[0]!.id], succeeded: [] });
    await settle();
    model = render();
    expect(model.selectedMessage?.isStarred).toBe(false);
    expect(model.workspace?.messages.items[0]?.isStarred).toBe(false);
    expect(model.readerError).toContain("previous state was restored");
  });

  it("keeps archive confirmation-first for destroy but optimistic for archive", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    api.getMessage.mockResolvedValueOnce(message());
    await model.selectMessage("message-a");
    model = render();
    const pending = Promise.withResolvers<{
      failed: readonly [];
      succeeded: readonly [typeof snapshot.messages.items[0]["id"]];
    }>();
    api.mutateMessages.mockReturnValueOnce(pending.promise);

    model.archive();
    model = render();
    expect(model.selectedMessage).toBeNull();
    expect(model.workspace?.messages.items).toHaveLength(0);

    pending.resolve({ failed: [], succeeded: [snapshot.messages.items[0]!.id] });
    api.getWorkspace.mockResolvedValueOnce({
      ...snapshot,
      messages: { items: [], nextCursor: null, total: 0 },
    });
    await settle();
    expect(api.mutateMessages).toHaveBeenCalledWith(
      { messageIds: [snapshot.messages.items[0]!.id], type: "archive" },
      "scope-a",
    );
  });

  it("reconciles a pending reader mutation against the newly selected mailbox", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    api.getMessage.mockResolvedValueOnce(message());
    await model.selectMessage("message-a");
    model = render();
    const pending = Promise.withResolvers<{
      failed: readonly [];
      succeeded: readonly [typeof snapshot.messages.items[0]["id"]];
    }>();
    api.mutateMessages.mockReturnValueOnce(pending.promise);

    model.toggleStar();
    model.selectMailbox(archiveId);
    expect(render().isReaderMutating).toBe(true);
    api.getWorkspace.mockResolvedValueOnce(archiveWorkspace());
    pending.resolve({ failed: [], succeeded: [snapshot.messages.items[0]!.id] });
    await settle();
    await settle();
    model = render();

    expect(api.getWorkspace).toHaveBeenLastCalledWith(
      { mailboxId: archiveId },
      "scope-a",
    );
    expect(model.activeMailboxId).toBe(archiveId);
    expect(model.workspace?.messages.items).toHaveLength(0);
    expect(model.selectedMessage).toBeNull();
    expect(model.isReaderMutating).toBe(false);
  });

  it("replaces an ambiguous optimistic result with authoritative workspace state", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    api.getMessage.mockResolvedValueOnce(message());
    await model.selectMessage("message-a");
    model = render();
    api.mutateMessages.mockResolvedValueOnce({
      failed: [],
      succeeded: [],
      unconfirmed: [snapshot.messages.items[0]!.id],
    });
    api.getWorkspace.mockResolvedValueOnce(snapshot);

    model.toggleStar();
    await settle();
    await settle();
    model = render();

    expect(api.getWorkspace).toHaveBeenLastCalledWith(
      { mailboxId: snapshot.mailboxes[0]!.id },
      "scope-a",
    );
    expect(model.workspace?.messages.items[0]?.isStarred).toBe(false);
    expect(model.selectedMessage).toBeNull();
    expect(model.isReaderMutating).toBe(false);
  });

  it("marks an opened unread message through the validated bulk mutation path", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    const unread = { ...message(), isUnread: true };
    api.getMessage.mockResolvedValueOnce(unread);
    api.mutateMessages.mockResolvedValueOnce({
      failed: [],
      succeeded: [unread.id],
    });
    api.getWorkspace.mockResolvedValueOnce(snapshot);

    await model.selectMessage("message-a");
    await settle();
    model = render();

    expect(api.mutateMessages).toHaveBeenCalledWith(
      { messageIds: [unread.id], type: "set-read", value: true },
      "scope-a",
    );
    expect(api.mutateMessage).not.toHaveBeenCalled();
    expect(model.selectedMessage?.isUnread).toBe(false);
  });

  it("refreshes the current view when auto-read has an ambiguous network failure", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    const unread = { ...message(), isUnread: true };
    api.getMessage.mockResolvedValueOnce(unread);
    api.mutateMessages.mockRejectedValueOnce(new Error("connection lost"));
    api.getWorkspace.mockResolvedValueOnce(snapshot);

    await model.selectMessage("message-a");
    await settle();
    model = render();

    expect(api.getWorkspace).toHaveBeenCalledTimes(2);
    expect(model.readerError).toContain("could not be confirmed");
    expect(model.selectedMessage?.isUnread).toBe(true);
  });
});
