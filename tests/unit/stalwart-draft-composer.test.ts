import { describe, expect, it } from "vitest";

import type { DraftContent } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import { createJmapDraftObject } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.composer";
import {
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";

const composeId = id.draft("5d91bdc1-7c39-465e-95c6-dd937398cc4f");
const content: DraftContent = {
  bcc: [{ email: "private@example.com", name: null }],
  body: "Updated reply",
  cc: [],
  subject: "Re: Existing",
  to: [{ email: "reader@example.com", name: null }],
};
const account = {
  email: "member@example.com",
  id: id.account("account"),
  name: "Authenticated Member",
  providerId: id.provider("stalwart-jmap"),
};

describe("Stalwart draft composition", () => {
  it("preserves provider metadata but replaces Veda keywords", () => {
    const oldCompose = id.draft("166e8e77-5a02-4379-9cae-e9953328b35d");
    const existing = {
      from: [{ email: account.email, name: "Original Draft Name" }],
      inReplyTo: ["reply@example.com"],
      keywords: {
        $draft: true,
        $flagged: true,
        "custom-user-keyword": true,
        [jmapDraftComposeKeyword(oldCompose)]: true,
        [jmapDraftContentKeyword({ ...content, body: "old" })]: true,
      },
      mailboxIds: { drafts: true, "project-label": true },
      messageId: ["stable@example.com"],
      references: ["parent@example.com"],
    } as unknown as JmapDraftEmail;

    const object = createJmapDraftObject(
      content,
      composeId,
      "drafts",
      account,
      null,
      existing,
    );

    expect(object).toMatchObject({
      from: [{ email: account.email, name: "Original Draft Name" }],
      "header:In-Reply-To:asMessageIds": ["reply@example.com"],
      keywords: {
        $draft: true,
        $flagged: true,
        "custom-user-keyword": true,
        [jmapDraftComposeKeyword(composeId)]: true,
        [jmapDraftContentKeyword(content)]: true,
      },
      mailboxIds: { drafts: true, "project-label": true },
    });
    const keywords = object["keywords"] as Readonly<Record<string, boolean>>;
    expect(keywords[jmapDraftComposeKeyword(oldCompose)]).toBeUndefined();
    expect(JSON.stringify(object)).not.toMatch(/x-veda/i);
  });

  it("omits private Veda keywords from an outgoing object", () => {
    const object = createJmapDraftObject(
      content,
      composeId,
      "drafts",
      account,
      null,
      undefined,
      { includeVedaKeywords: false },
    );
    const keywords = object["keywords"] as Readonly<Record<string, boolean>>;
    expect(Object.keys(keywords).some((key) => key.startsWith("veda-"))).toBe(
      false,
    );
  });
});
