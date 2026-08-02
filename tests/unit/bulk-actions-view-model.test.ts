import { describe, expect, it, vi } from "vitest";

import type { MailWorkspace, MailboxRole } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { createBulkActionsViewModel } from "@/presentation/features/mail-workspace/bulk-actions.view-model";

const mailbox = (role: MailboxRole) => ({
  color: "#000",
  id: id.mailbox(role),
  name: role[0]!.toUpperCase() + role.slice(1),
  parentId: null,
  role,
  rights: {
    mayAddItems: true, mayCreateChild: true, mayDelete: false,
    mayRemoveItems: true, mayRename: false,
  },
  sortOrder: 0,
  total: 1,
  unread: 0,
});
const workspace: MailWorkspace = {
  account: {
    email: "member@example.com",
    id: id.account("member"),
    name: "Member",
    providerId: id.provider("mock"),
  },
  draftCapability: { status: "supported" },
  labelCapability: "supported",
  labels: [],
  mailboxes: [
    mailbox("inbox"),
    mailbox("archive"),
    mailbox("spam"),
    mailbox("trash"),
    mailbox("drafts"),
    mailbox("sent"),
    mailbox("custom"),
  ],
  messageListPreferences: {
    confirmBeforeSend: false, density: "comfortable", showPreview: true,
    keyboardShortcuts: false, sort: "newest", undoSendSeconds: 0,
  },
  messages: { items: [], nextCursor: null, total: 0 },
  sessionExpiresAt: "2026-08-01T00:00:00.000Z",
  sessionScope: "scope-a",
};

type BulkModel = Parameters<typeof createBulkActionsViewModel>[0]["bulk"];
const bulk = () => ({
  allLoadedSelected: true,
  canStop: false,
  clear: vi.fn(),
  error: null,
  isBusy: false,
  mutate: vi.fn(),
  selectedIds: new Set([id.message("message-a")]),
  stop: vi.fn(),
  status: "",
  toggle: vi.fn(),
  toggleAllLoaded: vi.fn(),
}) as unknown as BulkModel;
const confirmation = (selection: BulkModel) => ({
  isOpen: false,
  onCancel: vi.fn(),
  onConfirm: () => void selection.mutate({
    mailboxId: id.mailbox("trash"), type: "destroy",
  }),
  onRequest: vi.fn(),
});

describe("bulk actions view model", () => {
  it("maps every inbox action to a provider-independent mutation", () => {
    const selection = bulk();
    const model = createBulkActionsViewModel({
      activeMailboxId: id.mailbox("inbox"),
      bulk: selection,
      destroyConfirmation: confirmation(selection),
      workspace,
    });

    expect(model).toMatchObject({
      canArchive: true,
      canDestroy: false,
      canRestore: false,
      canSpam: true,
      canTrash: true,
      selectedCount: 1,
    });
    expect(model.moveTargets.map((target) => target.id)).toEqual([
      "archive", "spam", "trash", "custom",
    ]);
    model.onMarkRead();
    model.onMarkUnread();
    model.onStar();
    model.onUnstar();
    model.onArchive();
    model.onSpam();
    model.onTrash();
    model.onMove("custom");
    const mutate = vi.mocked(selection.mutate);
    expect(mutate.mock.calls.map(([action]) => action)).toEqual([
      { type: "set-read", value: true },
      { type: "set-read", value: false },
      { type: "set-starred", value: true },
      { type: "set-starred", value: false },
      { type: "archive" },
      { destinationMailboxId: "spam", sourceMailboxId: "inbox", type: "move" },
      { type: "delete" },
      { destinationMailboxId: "custom", sourceMailboxId: "inbox", type: "move" },
    ]);
  });

  it("offers restore and confirmed permanent-delete intent in trash", () => {
    const selection = bulk();
    const model = createBulkActionsViewModel({
      activeMailboxId: id.mailbox("trash"),
      bulk: selection,
      destroyConfirmation: confirmation(selection),
      workspace,
    });

    expect(model.canRestore).toBe(true);
    expect(model.canDestroy).toBe(true);
    expect(model.canArchive).toBe(false);
    expect(model.canSpam).toBe(false);
    expect(model.canTrash).toBe(false);
    expect(model.restoreLabel).toBe(
      "Restore selected messages from Trash to Inbox",
    );
    expect(model.moveTargets.map(({ id: mailboxId }) => mailboxId)).not
      .toContain("spam");
    model.onRestore();
    model.destroyConfirmation.onConfirm();
    expect(selection.mutate).toHaveBeenNthCalledWith(1, { type: "restore" });
    expect(selection.mutate).toHaveBeenNthCalledWith(2, {
      mailboxId: "trash",
      type: "destroy",
    });
  });

  it("uses a dedicated Not spam action without generic lifecycle moves", () => {
    const selection = bulk();
    const model = createBulkActionsViewModel({
      activeMailboxId: id.mailbox("spam"),
      bulk: selection,
      destroyConfirmation: confirmation(selection),
      workspace,
    });

    expect(model).toMatchObject({
      canArchive: false,
      canDestroy: true,
      canRestore: true,
      canSpam: false,
      canTrash: false,
      restoreLabel: "Mark selected messages as not spam",
    });
    expect(model.moveTargets.map(({ id: mailboxId }) => mailboxId))
      .not.toContain("trash");
  });

  it("hides permanent delete when provider removal rights are denied", () => {
    const selection = bulk();
    const model = createBulkActionsViewModel({
      activeMailboxId: id.mailbox("trash"),
      bulk: selection,
      destroyConfirmation: confirmation(selection),
      workspace: {
        ...workspace,
        mailboxes: workspace.mailboxes.map((item) => item.role === "trash"
          ? { ...item, rights: { ...item.rights, mayRemoveItems: false } }
          : item),
      },
    });

    expect(model.canDestroy).toBe(false);
  });

  it("disables bulk selection for provider draft rows", () => {
    const selection = bulk();
    const model = createBulkActionsViewModel({
      activeMailboxId: id.mailbox("drafts"),
      bulk: selection,
      destroyConfirmation: confirmation(selection),
      workspace,
    });

    expect(model.selectedCount).toBe(0);
    expect(model.canArchive).toBe(false);
    expect(model.canSpam).toBe(false);
    expect(model.canTrash).toBe(false);
    expect(model.canDestroy).toBe(false);
  });

  it("hides a deleting label from new bulk mutations", () => {
    const selection = bulk();
    const deletingId = id.label("veda-label-aaaqeayeaudaocajbifqydiob4");
    const activeId = id.label("veda-label-aebagbafaydqqcikbmga2dqpca");
    const model = createBulkActionsViewModel({
      activeMailboxId: id.mailbox("inbox"),
      bulk: selection,
      destroyConfirmation: confirmation(selection),
      workspace: {
        ...workspace,
        labelDeletions: [{
          labelId: deletingId,
          processed: 10,
          removed: 2,
          startedAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:01.000Z",
        }],
        labels: [
          { color: "#ef4444", id: deletingId, name: "Deleting" },
          { color: "#10b981", id: activeId, name: "Active" },
        ],
      },
    });

    expect(model.labels).toEqual([
      { color: "#10b981", id: activeId, name: "Active" },
    ]);
  });
});
