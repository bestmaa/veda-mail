import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContactBook } from "@/domain/member/contact";
import { memberContactApi } from "@/transport/client/member-contact-api";

const emptyBook: ContactBook = {
  contacts: [],
  createdAt: null,
  groups: [],
  recents: [],
  revision: null,
  updatedAt: null,
  version: 1,
};
const scope = "contact-test-session-scope";

afterEach(() => vi.unstubAllGlobals());

describe("member contact API", () => {
  it("loads the scoped address book without browser caching", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: emptyBook }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(memberContactApi.get(scope)).resolves.toEqual(emptyBook);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/member/contacts",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-veda-mail-session-scope": scope },
        method: "GET",
      }),
    );
  });

  it("passes the optimistic revision operation and abort signal unchanged", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: emptyBook }),
    );
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const operation = {
      contact: {
        emails: [{ email: "ada@example.com", label: "Work" }],
        name: "Ada Lovelace",
      },
      expectedRevision: "11111111-1111-4111-8111-111111111111",
      operation: "create-contact" as const,
    };

    await memberContactApi.put(operation, scope, controller.signal);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init).toMatchObject({
      credentials: "same-origin",
      method: "PUT",
      signal: controller.signal,
    });
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-veda-mail-session-scope": scope,
    });
    expect(JSON.parse(String(init.body))).toEqual(operation);
  });

  it("imports vCard text with the current revision", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: emptyBook }),
    );
    vi.stubGlobal("fetch", fetch);
    await memberContactApi.importVCard(
      "BEGIN:VCARD\r\nEND:VCARD\r\n",
      "11111111-1111-4111-8111-111111111111",
      scope,
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/member/contacts/vcard",
      expect.objectContaining({
        body: JSON.stringify({
          expectedRevision: "11111111-1111-4111-8111-111111111111",
          vcard: "BEGIN:VCARD\r\nEND:VCARD\r\n",
        }),
        credentials: "same-origin",
        method: "POST",
      }),
    );
  });

  it("exports the scoped vCard as a Blob", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response("BEGIN:VCARD\r\nEND:VCARD\r\n", {
        headers: { "content-type": "text/vcard" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await memberContactApi.exportVCard(scope);
    expect(result.type).toBe("text/vcard");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/member/contacts/vcard",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-veda-mail-session-scope": scope },
        method: "GET",
      }),
    );
  });

  it("surfaces a typed revision conflict", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: {
        code: "CONTACT_BOOK_CONFLICT",
        message: "Contacts changed in another session. Reload and try again.",
      },
    }, { status: 409 })));

    await expect(memberContactApi.get(scope)).rejects.toMatchObject({
      code: "CONTACT_BOOK_CONFLICT",
      message: "Contacts changed in another session. Reload and try again.",
      name: "MemberContactApiError",
      status: 409,
    });
  });

  it("preserves session failures for the shared recovery handler", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: {
        code: "MEMBER_SESSION_EXPIRED",
        message: "Reconnect this mailbox.",
      },
    }, { status: 401 })));

    await expect(memberContactApi.get(scope)).rejects.toMatchObject({
      code: "MEMBER_SESSION_EXPIRED",
      status: 401,
    });
  });
});
