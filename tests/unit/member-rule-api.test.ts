import { afterEach, describe, expect, it, vi } from "vitest";

import { memberRuleApi } from "@/transport/client/member-rule-api";

const sessionScope = "scope-rules-test";
const book = {
  audit: [],
  deployment: { errorCode: null, status: "undeployed", updatedAt: "2026-08-04T00:00:00.000Z" },
  revision: null, rules: [], version: 1,
};

afterEach(() => vi.unstubAllGlobals());

describe("member rule API", () => {
  it("loads rules without caching and sends the mailbox scope", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      data: { book, capability: { maxRules: 50, maxScriptBytes: null,
        supported: false, supportedActions: [], supportedConditions: [], reason: "Unavailable" } },
    }));
    vi.stubGlobal("fetch", fetch);
    await memberRuleApi.get(sessionScope);
    expect(fetch).toHaveBeenCalledWith("/api/v1/member/rules", expect.objectContaining({
      cache: "no-store", credentials: "same-origin", method: "GET",
      headers: expect.objectContaining({ "x-veda-mail-session-scope": sessionScope }),
    }));
  });

  it("sends an operation unchanged and keeps conflict details", async () => {
    const operation = { expectedRevision: null, operation: "create" as const,
      definition: { actions: [{ kind: "mark-read" as const }],
        conditions: [{ kind: "subject" as const, operator: "contains" as const, value: "invoice" }],
        enabled: true, match: "all" as const, name: "Invoices", stopProcessing: false } };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: book }));
    vi.stubGlobal("fetch", fetch);
    await memberRuleApi.put(operation, sessionScope);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("PUT"); expect(JSON.parse(String(init.body))).toEqual(operation);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: { code: "MAIL_RULE_PROVIDER_CONFLICT", message: "A foreign script is active." },
    }, { status: 409 })));
    await expect(memberRuleApi.reconcile("d8aca933-2768-49d9-bd4e-8943d94deafa", sessionScope)).rejects.toMatchObject({
      code: "MAIL_RULE_PROVIDER_CONFLICT", message: "A foreign script is active.", status: 409,
    });
  });

  it("posts a bounded dry-run request with the session scope", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetch);
    await memberRuleApi.preview({ limit: 25, rules: [] }, sessionScope);
    expect(fetch).toHaveBeenCalledWith("/api/v1/member/rules/preview", expect.objectContaining({
      method: "POST", headers: expect.objectContaining({
        "Content-Type": "application/json", "x-veda-mail-session-scope": sessionScope,
      }),
    }));
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ limit: 25, rules: [] });
  });
});
