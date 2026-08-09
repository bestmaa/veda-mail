import { afterEach, describe, expect, it, vi } from "vitest";

import type { MessagePrintDocument } from "@/domain/mail/message-print";
import { id } from "@/domain/shared/brand";
import { messagePrintApi } from "@/transport/client/message-print-api";

const document: MessagePrintDocument = {
  anchorMessageId: id.message("anchor?#"),
  messages: [],
  scope: "conversation",
  total: 0,
  truncated: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("message print API client", () => {
  it("encodes the message ID and sends only scope, session scope, and abort signal", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: document }),
    );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;

    await expect(messagePrintApi.create(
      id.message("anchor?#"),
      "conversation",
      "print-session-scope",
      signal,
    )).resolves.toEqual(document);

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/mail/messages/anchor%3F%23/print",
      {
        body: JSON.stringify({ scope: "conversation" }),
        headers: {
          "Content-Type": "application/json",
          "x-veda-mail-session-scope": "print-session-scope",
        },
        method: "POST",
        signal,
      },
    );
  });
});
