import { afterEach, describe, expect, it, vi } from "vitest";
import { id } from "@/domain/shared/brand";
import { snoozeApi } from "@/transport/client/snooze-api";

const scope = "snooze-scope";
afterEach(() => vi.unstubAllGlobals());

describe("snooze API", () => {
  it("loads without caching and sends the mailbox scope", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: {
      book: { messages: [], revision: null, snoozedMailboxId: null, version: 1 },
      capability: { maxMessages: 0, reason: "Unavailable", snoozedMailboxId: null, supported: false },
    } }));
    vi.stubGlobal("fetch", fetch); await snoozeApi.get(scope);
    expect(fetch).toHaveBeenCalledWith("/api/v1/mail/snoozed", expect.objectContaining({
      cache: "no-store", credentials: "same-origin", method: "GET",
      headers: expect.objectContaining({ "x-veda-mail-session-scope": scope }),
    }));
  });

  it("posts source-scoped items unchanged", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: {
      book: { messages: [], revision: null, snoozedMailboxId: null, version: 1 }, outcomes: [],
    } }));
    vi.stubGlobal("fetch", fetch);
    const items = [{ messageId: id.message("message-1"), sourceMailboxId: id.mailbox("inbox"), wakeAt: "2026-08-05T03:00:00.000Z" }];
    await snoozeApi.create(items, scope);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST"); expect(JSON.parse(String(init.body))).toEqual({ items });
    expect(init.headers).toMatchObject({ "x-veda-mail-session-scope": scope });
  });

  it("restores and retries without sending a request body", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: {
      messages: [], revision: null, snoozedMailboxId: null, version: 1,
    } }));
    vi.stubGlobal("fetch", fetch);
    await snoozeApi.restore("job/1", scope); await snoozeApi.retry("job/1", scope);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.method).toBe("POST"); expect(init?.body).toBeUndefined();
    }
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/v1/mail/snoozed/job%2F1/restore");
  });
});
