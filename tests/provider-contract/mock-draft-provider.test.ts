import { describe, expect, it } from "vitest";

import type { DraftContent } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import { MockMailGateway } from "@/infrastructure/providers/mock/mock-mail.gateway";
import { mockMailboxIds } from "@/infrastructure/providers/mock/mock-seed";

const composeId = id.draft("c61d80d4-13bb-4cfd-aee1-b2560ab99210");
const content: DraftContent = {
  bcc: [{ email: "private@example.com", name: "Private" }],
  body: "Provider draft body",
  cc: [{ email: "copy@example.com", name: null }],
  htmlBody: "<p>Provider draft body</p>",
  subject: "Provider draft",
  to: [{ email: "reader@example.com", name: "Reader" }],
};

describe("mock provider draft contract", () => {
  it("creates, lists, loads, replaces, and discards a draft", async () => {
    const gateway = new MockMailGateway();
    await expect(gateway.getDraftCapability()).resolves.toEqual({
      status: "supported",
    });

    const created = await gateway.saveDraft({ composeId, content });
    expect(created).toMatchObject({
      composeId,
      content,
      hasAttachments: false,
    });
    const listed = await gateway.listMessages({
      limit: 10,
      mailboxId: mockMailboxIds.drafts,
    });
    expect(listed.items.map(({ id: draftId }) => draftId)).toContain(
      created.id,
    );
    await expect(gateway.getDraft(created.id)).resolves.toEqual(created);

    const replacement = await gateway.saveDraft({
      composeId,
      content: { ...content, body: "Revised body" },
      expectedRevision: created.revision,
      providerDraftId: created.id,
    });
    expect(replacement.id).not.toBe(created.id);
    await expect(gateway.getDraft(created.id)).rejects.toThrow(
      "Draft not found",
    );
    await expect(
      gateway.discardDraft(replacement.id, "stale-revision"),
    ).rejects.toThrow("changed since it was last loaded");

    await gateway.discardDraft(replacement.id, replacement.revision);
    await expect(gateway.getDraft(replacement.id)).rejects.toThrow(
      "Draft not found",
    );
    const afterDiscard = await gateway.listMessages({
      limit: 10,
      mailboxId: mockMailboxIds.drafts,
    });
    expect(afterDiscard.items.map(({ id: draftId }) => draftId)).not.toContain(
      replacement.id,
    );
  });

  it("reconciles an identical create and conflicts on changed intent", async () => {
    const gateway = new MockMailGateway();
    const created = await gateway.saveDraft({ composeId, content });

    await expect(gateway.saveDraft({ composeId, content })).resolves.toEqual(
      created,
    );
    await expect(
      gateway.saveDraft({
        composeId,
        content: { ...content, subject: "Different intent" },
      }),
    ).rejects.toThrow("changed since it was last loaded");
  });

  it("reconciles an exact lost update without duplicating its replacement", async () => {
    const gateway = new MockMailGateway();
    const created = await gateway.saveDraft({ composeId, content });
    const update = {
      composeId,
      content: { ...content, body: "Autosaved replacement" },
      expectedRevision: created.revision,
      providerDraftId: created.id,
    } as const;
    const replacement = await gateway.saveDraft(update);

    await expect(gateway.saveDraft(update)).resolves.toEqual(replacement);
    await expect(gateway.saveDraft({
      ...update,
      content: { ...update.content, body: "Changed retry intent" },
    })).rejects.toThrow("changed since it was last loaded");
    await expect(gateway.saveDraft({
      ...update,
      expectedRevision: "different-base-revision",
    })).rejects.toThrow("changed since it was last loaded");

    const drafts = await gateway.listMessages({
      limit: 10,
      mailboxId: mockMailboxIds.drafts,
    });
    expect(drafts.items.filter(({ id: draftId }) =>
      String(draftId) === String(replacement.id))).toHaveLength(1);
    await expect(gateway.getDraft(created.id)).rejects.toThrow(
      "Draft not found",
    );
  });

  it("hands a saved draft to send without leaving a Drafts ghost", async () => {
    const gateway = new MockMailGateway();
    const created = await gateway.saveDraft({ composeId, content });
    const receipt = await gateway.sendMessage({
      ...content,
      providerDraft: {
        composeId,
        expectedRevision: created.revision,
        id: created.id,
      },
    });

    expect(receipt.deliveryStatus).toBe("accepted");
    await expect(gateway.getDraft(created.id)).rejects.toThrow(
      "Draft not found",
    );
    const drafts = await gateway.listMessages({
      limit: 10,
      mailboxId: mockMailboxIds.drafts,
    });
    expect(drafts.items.map(({ id: draftId }) => draftId)).not.toContain(
      created.id,
    );
  });
});
