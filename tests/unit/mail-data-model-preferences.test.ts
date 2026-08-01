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

describe("mail data message-list preferences", () => {
  it("persists density locally without refetching the mailbox", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();
    api.saveMessageListPreferences.mockResolvedValueOnce({
      preferences: { density: "compact", showPreview: true, sort: "newest" },
    });

    await model.saveListPreferences({
      density: "compact", showPreview: true, sort: "newest",
    });
    model = render();

    expect(api.saveMessageListPreferences).toHaveBeenCalledWith(
      { density: "compact", showPreview: true, sort: "newest" },
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
      preferences: { density: "spacious", showPreview: false, sort: "oldest" },
    });
    api.getWorkspace.mockResolvedValueOnce({
      ...workspace("scope-a"),
      messageListPreferences: {
        density: "spacious", showPreview: false, sort: "oldest",
      },
    });

    await model.saveListPreferences({
      density: "spacious", showPreview: false, sort: "oldest",
    });
    model = render();

    expect(api.getWorkspace).toHaveBeenLastCalledWith({
      mailboxId: inboxId,
      showPreview: false,
      sort: "oldest",
    }, "scope-a");
    expect(model.workspace?.messageListPreferences).toEqual({
      density: "spacious", showPreview: false, sort: "oldest",
    });
  });

  it("rejects a save that completes after the account scope changes", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();
    const pending = Promise.withResolvers<{
      preferences: { density: "compact"; showPreview: true; sort: "newest" };
    }>();
    api.saveMessageListPreferences.mockReturnValueOnce(pending.promise);
    const staleSave = model.saveListPreferences({
      density: "compact", showPreview: true, sort: "newest",
    });

    api.getWorkspace.mockResolvedValueOnce(workspace("scope-b"));
    await refresh(model);
    pending.resolve({
      preferences: { density: "compact", showPreview: true, sort: "newest" },
    });

    await expect(staleSave).rejects.toThrow("mailbox session changed");
    expect(render().workspace?.sessionScope).toBe("scope-b");
  });
});
