import { afterEach, describe, expect, it, vi } from "vitest";

import { adminSecurityAuditApi } from "@/transport/client/admin-security-audit-api";

afterEach(() => vi.unstubAllGlobals());

describe("administrator security audit client", () => {
  it("encodes bounded pagination and requests a no-store page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        droppedCount: 0, entries: [], nextCursor: null,
        verifiedAt: "2026-08-06T00:00:00.000Z",
      },
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await adminSecurityAuditApi.list({ beforeSequence: 42, limit: 25 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/audit?beforeSequence=42&limit=25",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
