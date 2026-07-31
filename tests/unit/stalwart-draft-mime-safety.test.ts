import { describe, expect, it } from "vitest";

import {
  hasSupportedDraftHeaderInventory,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-header-safety";
import { hasSupportedDraftBodyStructure } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-mime-safety";
import { mapJmapDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import {
  jmapDraftEmailSchema,
  type JmapDraftEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import { safeStalwartDraftShape } from "./stalwart-draft-safe-shape";

const safe = () =>
  ({
    ...safeStalwartDraftShape({
      bcc: [{ email: "hidden@example.com", name: null }],
      from: [{ email: "member@example.com", name: "Member" }],
      htmlPartId: "html",
      messageId: "draft@example.com",
      to: [{ email: "reader@example.com", name: null }],
    }),
    bcc: [{ email: "hidden@example.com", name: null }],
    from: [{ email: "member@example.com", name: "Member" }],
    to: [{ email: "reader@example.com", name: null }],
  }) as unknown as JmapDraftEmail;

const parseable = (overrides: Record<string, unknown> = {}) => ({
  ...safe(),
  bodyValues: {
    html: { value: "<p>Safe</p>" },
    text: { value: "Safe" },
  },
  hasAttachment: false,
  id: "draft",
  keywords: { $draft: true },
  mailboxIds: { drafts: true },
  messageId: ["draft@example.com"],
  receivedAt: "2026-07-31T10:00:00.000Z",
  references: [],
  subject: "",
  ...overrides,
});

describe("Stalwart editable MIME safety", () => {
  it("accepts the canonical plain/html alternative shape", () => {
    expect(hasSupportedDraftHeaderInventory(safe())).toBe(true);
    expect(hasSupportedDraftBodyStructure(safe())).toBe(true);
  });

  it("rejects unknown, duplicate, grouped, and flowed metadata", () => {
    const email = safe();
    expect(
      hasSupportedDraftHeaderInventory({
        ...email,
        headers: [...(email.headers ?? []), { name: "X-Custom", value: "x" }],
      }),
    ).toBe(false);
    expect(
      hasSupportedDraftHeaderInventory({
        ...email,
        headers: [...(email.headers ?? []), { name: "Bcc", value: "again" }],
      }),
    ).toBe(false);
    expect(
      hasSupportedDraftHeaderInventory({
        ...email,
        "header:To:asGroupedAddresses:all": [
          [{ addresses: [], name: "Undisclosed recipients" }],
        ],
      }),
    ).toBe(false);
    const body = email.bodyStructure!;
    expect(
      hasSupportedDraftBodyStructure({
        ...email,
        bodyStructure: {
          ...body,
          subParts: (body.subParts ?? []).map((part, index) =>
            index === 0
              ? {
                  ...part,
                  headers: [
                    {
                      name: "Content-Type",
                      value: "text/plain; format=flowed; delsp=yes",
                    },
                  ],
                }
              : part,
          ),
        },
      }),
    ).toBe(false);
  });

  it("rejects deeply nested provider MIME without recursive overflow", () => {
    let bodyStructure: Record<string, unknown> = {
      headers: [],
      type: "text/plain",
    };
    for (let depth = 0; depth < 10_000; depth += 1) {
      bodyStructure = {
        headers: [],
        subParts: [bodyStructure],
        type: "multipart/alternative",
      };
    }
    expect(() =>
      jmapDraftEmailSchema.safeParse({
        bodyStructure,
        hasAttachment: false,
        id: "deep",
        keywords: {},
        mailboxIds: {},
        receivedAt: "2026-07-31T10:00:00.000Z",
        subject: "",
      }),
    ).not.toThrow();
    const parsed = jmapDraftEmailSchema.safeParse({
      bodyStructure,
      hasAttachment: false,
      id: "deep",
      keywords: {},
      mailboxIds: {},
      receivedAt: "2026-07-31T10:00:00.000Z",
      subject: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.bodyStructure).toBeUndefined();
  });

  it("parses duplicate address headers and many parts as read-only", () => {
    const base = safe();
    const duplicate = jmapDraftEmailSchema.parse(
      parseable({
        headers: [...(base.headers ?? []), { name: "Bcc", value: "again" }],
        "header:Bcc:asGroupedAddresses:all": [
          [{ addresses: base.bcc ?? [], name: null }],
          [{ addresses: base.bcc ?? [], name: null }],
        ],
      }),
    );
    expect(mapJmapDraft(duplicate, "account", "drafts").hasTruncatedContent).toBe(
      true,
    );
    const part = base.bodyStructure?.subParts?.[0];
    const many = jmapDraftEmailSchema.parse(
      parseable({
        bodyStructure: {
          ...base.bodyStructure,
          subParts: Array.from({ length: 5 }, () => part),
        },
      }),
    );
    expect(mapJmapDraft(many, "account", "drafts").hasTruncatedContent).toBe(
      true,
    );
  });
});
