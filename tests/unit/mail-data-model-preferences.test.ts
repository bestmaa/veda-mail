import { beforeEach, describe, expect, it } from "vitest";

import {
  api,
  inboxId,
  refresh,
  render,
  resetMailDataModelHarness,
  workspace,
} from "./mail-data-model-session-scope.test-support";

beforeEach(resetMailDataModelHarness);

const compact = {
  confirmBeforeSend: false, density: "compact", showPreview: true,
  sort: "newest", undoSendSeconds: 0,
} as const;
const spacious = {
  confirmBeforeSend: true, density: "spacious", showPreview: false,
  sort: "oldest", undoSendSeconds: 10,
} as const;

describe("mail data message-list preferences", () => {
  it("persists density locally without refetching the mailbox", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();
    api.saveMessageListPreferences.mockResolvedValueOnce({
      preferences: compact,
    });

    await model.saveListPreferences(compact);
    model = render();

    expect(api.saveMessageListPreferences).toHaveBeenCalledWith(
      compact,
      "scope-a",
    );
    expect(api.getWorkspace).toHaveBeenCalledOnce();
    expect(model.workspace?.messageListPreferences.density).toBe("compact");
  });

  it("refetches with the saved projection and ordering", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();
    api.saveMessageListPreferences.mockResolvedValueOnce({
      preferences: spacious,
    });
    api.getWorkspace.mockResolvedValueOnce({
      ...workspace("scope-a"),
      messageListPreferences: spacious,
    });

    await model.saveListPreferences(spacious);
    model = render();

    expect(api.getWorkspace).toHaveBeenLastCalledWith({
      mailboxId: inboxId,
      showPreview: false,
      sort: "oldest",
    }, "scope-a");
    expect(model.workspace?.messageListPreferences).toEqual(spacious);
  });

  it("rejects a save that completes after the account scope changes", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();
    const pending = Promise.withResolvers<{ preferences: typeof compact }>();
    api.saveMessageListPreferences.mockReturnValueOnce(pending.promise);
    const staleSave = model.saveListPreferences(compact);

    api.getWorkspace.mockResolvedValueOnce(workspace("scope-b"));
    await refresh(model);
    pending.resolve({ preferences: compact });

    await expect(staleSave).rejects.toThrow("mailbox session changed");
    expect(render().workspace?.sessionScope).toBe("scope-b");
  });
});
