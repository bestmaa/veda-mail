import { describe, expect, it } from "vitest";

import {
  createDraftSchema,
  deleteDraftSchema,
  providerDraftIdSchema,
  updateDraftSchema,
} from "@/transport/http/draft-schemas";

const composeId = "11111111-1111-4111-8111-111111111111";
const address = (email: string, name: string | null = null) => ({
  email,
  name,
});

describe("draft request validation", () => {
  it("accepts a completely blank partial draft with canonical defaults", () => {
    expect(
      createDraftSchema.parse({ composeId, content: {} }),
    ).toEqual({
      attachmentIds: [],
      composeId,
      content: {
        bcc: [],
        body: "",
        cc: [],
        subject: "",
        to: [],
      },
      retainedAttachmentIds: [],
    });
  });

  it("normalizes and deduplicates recipients without requiring any", () => {
    const parsed = createDraftSchema.parse({
      composeId,
      content: {
        bcc: [address("OTHER@example.com")],
        cc: [address("person@example.com", "Duplicate")],
        to: [address(" Person@Example.com ", " Person ")],
      },
    });

    expect(parsed.content.to).toEqual([
      address("Person@Example.com", "Person"),
    ]);
    expect(parsed.content.cc).toEqual([]);
    expect(parsed.content.bcc).toEqual([address("OTHER@example.com")]);
  });

  it.each([
    { accountId: "account" },
    { providerId: "stalwart" },
    { mailboxId: "drafts" },
    { threadId: "thread" },
    { attachmentIds: ["upload"] },
    { references: ["raw-header-id"] },
  ])("rejects content authority and unsupported fields: %o", (extra) => {
    expect(() =>
      createDraftSchema.parse({
        composeId,
        content: { ...extra },
      }),
    ).toThrow("Unrecognized key");
  });

  it("rejects unknown top-level fields", () => {
    expect(() =>
      createDraftSchema.parse({
        composeId,
        content: {},
        expectedRevision: "state-1",
      }),
    ).toThrow("Unrecognized key");
  });

  it("accepts bounded unique upload and retained selections only on updates", () => {
    expect(updateDraftSchema.parse({
      attachmentIds: ["upload-1"], composeId, content: {},
      expectedRevision: "revision", retainedAttachmentIds: ["provider-1"],
    })).toMatchObject({
      attachmentIds: ["upload-1"], retainedAttachmentIds: ["provider-1"],
    });
    expect(() => createDraftSchema.parse({
      composeId, content: {}, retainedAttachmentIds: ["provider-1"],
    })).toThrow("cannot retain");
    expect(() => updateDraftSchema.parse({
      attachmentIds: ["same", "same"], composeId, content: {},
      expectedRevision: "revision",
    })).toThrow("must be unique");
    expect(() => updateDraftSchema.parse({
      attachmentIds: Array.from({ length: 6 }, (_, index) => `new-${index}`),
      composeId, content: {}, expectedRevision: "revision",
      retainedAttachmentIds: Array.from(
        { length: 5 }, (_, index) => `saved-${index}`,
      ),
    })).toThrow("at most 10");
  });

  it("preserves recipient, subject, reply, and content limits", () => {
    const content = (overrides: Record<string, unknown>) => ({
      composeId,
      content: overrides,
    });
    expect(() =>
      createDraftSchema.parse(
        content({ to: [address(`${"a".repeat(244)}@example.com`)] }),
      ),
    ).toThrow("Email addresses cannot exceed 254 characters");
    expect(() =>
      createDraftSchema.parse(content({ subject: "a".repeat(999) })),
    ).toThrow("Subject cannot exceed 998 characters");
    expect(() =>
      createDraftSchema.parse(content({ inReplyTo: "a".repeat(2_049) })),
    ).toThrow("Reply message identifiers cannot exceed 2,048 characters");
    expect(() =>
      createDraftSchema.parse(content({ body: "a".repeat(256_001) })),
    ).toThrow("Draft body cannot exceed 256,000 characters");
  });

  it("requires bounded optimistic revisions on update and delete", () => {
    expect(() =>
      updateDraftSchema.parse({ composeId, content: {} }),
    ).toThrow();
    expect(() => deleteDraftSchema.parse({})).toThrow();
    expect(() =>
      deleteDraftSchema.parse({ expectedRevision: "x".repeat(256) }),
    ).toThrow("The draft revision is invalid");
  });

  it("accepts bounded opaque provider IDs but not compose UUID semantics", () => {
    expect(providerDraftIdSchema.parse("provider_draft-42")).toBe(
      "provider_draft-42",
    );
    expect(() => providerDraftIdSchema.parse("draft/42")).toThrow(
      "The saved draft identifier is invalid",
    );
    expect(() => providerDraftIdSchema.parse("x".repeat(256))).toThrow(
      "The saved draft identifier is invalid",
    );
  });
});
