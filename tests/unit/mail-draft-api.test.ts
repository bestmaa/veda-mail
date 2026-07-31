import { afterEach, describe, expect, it, vi } from "vitest";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import { mailApi } from "@/transport/client/mail-api";

const composeId = id.draft("11111111-1111-4111-8111-111111111111");
const draftId = id.providerDraft("provider-draft-42");
const content: DraftContent = {
  bcc: [],
  body: "Draft body",
  cc: [],
  subject: "Draft subject",
  to: [],
};
const detail: DraftDetail = {
  composeId,
  content,
  hasAttachments: false,
  hasTruncatedContent: false,
  hasUncertainSubmission: false,
  id: draftId,
  revision: "state-2",
  updatedAt: "2026-07-31T01:00:00.000Z",
};
const sessionScope = "mail-session-scope";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mail draft API client", () => {
  it("creates, gets, updates, and deletes with scope and abort signals", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({ data: detail }),
    );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;

    await expect(
      mailApi.createDraft(composeId, content, sessionScope, signal),
    ).resolves.toEqual(detail);
    await expect(
      mailApi.getDraft(draftId, sessionScope, signal),
    ).resolves.toEqual(detail);
    await expect(
      mailApi.updateDraft(
        draftId,
        { composeId, content, expectedRevision: "state-1" },
        sessionScope,
        signal,
      ),
    ).resolves.toEqual(detail);
    await expect(
      mailApi.deleteDraft(draftId, "state-2", sessionScope, signal),
    ).resolves.toBeUndefined();

    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/v1/mail/drafts", "POST"],
      ["/api/v1/mail/drafts/provider-draft-42", undefined],
      ["/api/v1/mail/drafts/provider-draft-42", "PUT"],
      ["/api/v1/mail/drafts/provider-draft-42", "DELETE"],
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(init).toMatchObject({
        headers: expect.objectContaining({
          "x-veda-mail-session-scope": sessionScope,
        }),
        signal,
      });
    }
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      composeId,
      content,
    });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
      composeId,
      content,
      expectedRevision: "state-1",
    });
    expect(JSON.parse(String(fetch.mock.calls[3]?.[1]?.body))).toEqual({
      expectedRevision: "state-2",
    });
  });

  it("encodes opaque provider IDs in item routes", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: detail }),
    );
    vi.stubGlobal("fetch", fetch);

    await mailApi.getDraft(
      id.providerDraft("opaque draft?#"),
      sessionScope,
    );

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/mail/drafts/opaque%20draft%3F%23",
      expect.any(Object),
    );
  });

  it("passes saved-draft handoff fields through send unchanged", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        data: {
          deliveryStatus: "accepted",
          id: "sent-message",
          rejectedRecipients: [],
          submittedAt: "2026-07-31T02:00:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await mailApi.sendMessage(
      {
        bcc: [],
        body: "Send",
        cc: [],
        draftId: composeId,
        expectedDraftRevision: "state-2",
        providerDraftId: draftId,
        subject: "Send",
        to: [{ email: "recipient@example.com", name: null }],
      },
      sessionScope,
    );

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      draftId: composeId,
      expectedDraftRevision: "state-2",
      providerDraftId: draftId,
    });
  });
});
