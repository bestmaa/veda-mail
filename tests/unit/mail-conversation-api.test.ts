import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationPage } from "@/domain/mail/conversation";
import { id } from "@/domain/shared/brand";
import { mailApi } from "@/transport/client/mail-api";

const sessionScope = "conversation-session-scope";
const page: ConversationPage = {
  anchorMessageId: id.message("anchor?#"),
  items: [],
  nextCursor: "opaque cursor?#",
  strategy: "native",
  total: 0,
  truncated: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mail conversation API client", () => {
  it("encodes the anchor and cursor and sends session scope and abort signal", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: page }),
    );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;

    await expect(mailApi.getConversation(
      id.message("anchor?#"),
      sessionScope,
      "opaque cursor?#",
      signal,
    )).resolves.toEqual(page);

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/mail/messages/anchor%3F%23/conversation?cursor=opaque+cursor%3F%23",
      {
        headers: { "x-veda-mail-session-scope": sessionScope },
        signal,
      },
    );
  });

  it("omits the query string when loading the first page", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: page }),
    );
    vi.stubGlobal("fetch", fetch);

    await mailApi.getConversation(id.message("anchor"), sessionScope);

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/mail/messages/anchor/conversation",
      expect.any(Object),
    );
  });
});
