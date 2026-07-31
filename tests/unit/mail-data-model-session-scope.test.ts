import { beforeEach, describe, expect, it } from "vitest";

import type { MessageDetail } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  api,
  ApiClientError,
  inboxId,
  message,
  refresh,
  render,
  resetMailDataModelHarness,
  settle,
  workspace,
} from "./mail-data-model-session-scope.test-support";

beforeEach(resetMailDataModelHarness);

describe("mail data session scope lifecycle", () => {
  it("clears an A reader and ignores its pending response when scope B arrives", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();

    api.getMessage.mockResolvedValueOnce(message());
    await model.selectMessage("message-a");
    model = render();
    expect(model.selectedMessage?.subject).toBe("Account A");

    const pending = Promise.withResolvers<MessageDetail>();
    api.getMessage.mockReturnValueOnce(pending.promise);
    const staleRead = model.selectMessage("late-a");
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-b"));
    await refresh(model);
    model = render();

    expect(api.getWorkspace).toHaveBeenLastCalledWith(
      { mailboxId: inboxId },
      "scope-a",
    );
    expect(model.sessionScope).toBe("scope-b");
    expect(model.selectedMessage).toBeNull();
    expect(model.isReaderLoading).toBe(false);

    pending.resolve(message("late-a"));
    await staleRead;
    expect(render().selectedMessage).toBeNull();
  });

  it.each([
    [
      "a scope mismatch",
      new ApiClientError(
        "Mailbox session changed.",
        409,
        "MAIL_SESSION_CHANGED",
      ),
    ],
    [
      "authenticated refresh loss",
      new ApiClientError(
        "Reconnect this mailbox.",
        401,
        "MEMBER_SESSION_EXPIRED",
      ),
    ],
  ])("clears every account-owned field on %s", async (_, failure) => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();
    api.getMessage.mockResolvedValueOnce(message());
    await model.selectMessage("message-a");
    model = render();

    api.getWorkspace.mockRejectedValueOnce(failure);
    await refresh(model);
    model = render();

    expect([model.workspace, model.sessionScope]).toEqual([null, ""]);
    expect(model.selectedMessage).toBeNull();
    expect([model.activeMailboxId, model.searchValue]).toEqual([null, ""]);
    expect(model.isLoading).toBe(false);
    expect(model.error).toBe(failure.message);

    await refresh(model);
    expect(api.getWorkspace).toHaveBeenCalledTimes(2);
  });

  it("clears the accepted scope when an authenticated message read is lost", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();
    api.getMessage.mockRejectedValueOnce(
      new ApiClientError(
        "Reconnect this mailbox.",
        401,
        "MEMBER_SESSION_EXPIRED",
      ),
    );

    await model.selectMessage("message-a");
    model = render();

    expect(api.getMessage).toHaveBeenCalledWith(
      id.message("message-a"),
      "scope-a",
    );
    expect(model.workspace).toBeNull();
    expect(model.sessionScope).toBe("");
    expect(model.selectedMessage).toBeNull();
    expect(model.isReaderLoading).toBe(false);
  });

  it("clears the accepted scope when an authenticated mutation is lost", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();
    api.getMessage.mockResolvedValueOnce(message());
    await model.selectMessage("message-a");
    model = render();
    api.mutateMessage.mockRejectedValueOnce(
      new ApiClientError(
        "Reconnect this mailbox.",
        401,
        "MEMBER_SESSION_REQUIRED",
      ),
    );

    model.archive();
    await settle();
    model = render();

    expect(api.mutateMessage).toHaveBeenCalledWith(
      { messageId: id.message("message-a"), type: "archive" },
      "scope-a",
    );
    expect(model.workspace).toBeNull();
    expect(model.sessionScope).toBe("");
    expect(model.selectedMessage).toBeNull();
  });

  it("lets every scoped child client invalidate the shared mail session once", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();

    const failure = new ApiClientError(
      "Mailbox session changed. Reload this page and try again.",
      409,
      "MAIL_SESSION_CHANGED",
    );
    expect(model.handleSessionFailure(failure)).toBe(true);
    model = render();

    expect([model.workspace, model.sessionScope]).toEqual([null, ""]);
    expect(model.error).toBe(failure.message);
    expect(model.handleSessionFailure(failure)).toBe(true);
    await refresh(model);
    expect(api.getWorkspace).toHaveBeenCalledOnce();
  });
});
