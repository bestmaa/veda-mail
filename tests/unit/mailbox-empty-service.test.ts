import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import { MailboxEmptyCursorError } from "@/domain/mail/mailbox-empty";
import type { Mailbox, MailboxRole } from "@/domain/mail/mailbox";
import { id } from "@/domain/shared/brand";

const mocks = vi.hoisted(() => ({
  abandon: vi.fn(),
  cancel: vi.fn(),
  claim: vi.fn(),
  record: vi.fn(),
  release: vi.fn(),
  installationGet: vi.fn(),
}));

vi.mock("@/server/mailboxes/mailbox-empty-operation.store", () => ({
  mailboxEmptyOperationStore: mocks,
}));
vi.mock("@/server/installation/installation.store", () => ({
  installationStore: { get: mocks.installationGet },
}));

import { emptyMailboxBatch } from "@/server/mailboxes/mailbox-empty.service";

const mailboxId = id.mailbox("mailbox-a");
const owner = { email: "member@example.com", providerId: "mock" };
const mailbox = (role: MailboxRole): Mailbox => ({
  color: "#ef4444",
  id: mailboxId,
  name: role,
  parentId: null,
  rights: {
    mayCreateChild: false,
    mayDelete: false,
    mayRemoveItems: true,
    mayRename: false,
  },
  role,
  sortOrder: 0,
  total: 1,
  unread: 0,
});
const service = (role: MailboxRole, emptyMailbox = vi.fn()) => ({
  emptyMailbox,
  listMailboxes: vi.fn().mockResolvedValue([mailbox(role)]),
}) as unknown as MailApplicationService;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.abandon.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.claim.mockResolvedValue({ cursor: null, leaseId: "lease", mailboxId });
  mocks.record.mockResolvedValue({ complete: false, processed: 0, removed: 0 });
  mocks.release.mockResolvedValue(undefined);
  mocks.installationGet.mockResolvedValue({ sessionSecret: "installation-secret" });
});

describe("mailbox empty service", () => {
  it("allows only server-authoritative Spam or Trash roles", async () => {
    await expect(emptyMailboxBatch(service("inbox"), owner, mailboxId))
      .rejects.toMatchObject({ code: "MAILBOX_EMPTY_FORBIDDEN", status: 403 });
    expect(mocks.cancel).toHaveBeenCalledWith(owner, mailboxId);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("runs a prepared provider batch with a server-owned cursor", async () => {
    const provider = vi.fn().mockResolvedValue({
      complete: false,
      cursor: "prepared",
      processed: 0,
      removed: 0,
    });
    const update = await emptyMailboxBatch(service("trash", provider), owner, mailboxId);

    expect(provider).toHaveBeenCalledWith(
      { limit: 100, mailboxId },
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
    );
    expect(mocks.record).toHaveBeenCalledWith(
      owner,
      { cursor: null, leaseId: "lease", mailboxId },
      { complete: false, cursor: "prepared", processed: 0, removed: 0 },
    );
    expect(update).toEqual({ complete: false, processed: 0, removed: 0 });
  });

  it("abandons an expired snapshot instead of widening deletion", async () => {
    const provider = vi.fn().mockRejectedValue(new MailboxEmptyCursorError());
    mocks.claim.mockResolvedValue({
      cursor: "old-cursor",
      leaseId: "lease",
      mailboxId,
    });

    await expect(emptyMailboxBatch(service("spam", provider), owner, mailboxId))
      .rejects.toMatchObject({
        code: "MAILBOX_EMPTY_SNAPSHOT_EXPIRED",
        status: 409,
      });
    expect(mocks.abandon).toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("abandons an unprepared operation when provider preparation fails", async () => {
    const provider = vi.fn().mockRejectedValue(new Error("secret upstream text"));

    await expect(emptyMailboxBatch(service("trash", provider), owner, mailboxId))
      .rejects.toThrow("secret upstream text");
    expect(mocks.abandon).toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases a prepared lease when a resumable provider batch fails", async () => {
    const provider = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    mocks.claim.mockResolvedValue({
      cursor: "prepared-cursor", leaseId: "lease", mailboxId,
    });

    await expect(emptyMailboxBatch(service("trash", provider), owner, mailboxId))
      .rejects.toThrow("provider unavailable");
    expect(mocks.release).toHaveBeenCalled();
    expect(mocks.abandon).not.toHaveBeenCalled();
  });
});
