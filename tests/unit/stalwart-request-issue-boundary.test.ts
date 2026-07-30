import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const policyMocks = vi.hoisted(() => ({
  assertSafeProviderOrigin: vi.fn(),
}));

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: policyMocks.assertSafeProviderOrigin,
}));

import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  StalwartJmapHttpError,
  type StalwartJmapRequestBoundary,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { submitStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-submission";
import {
  JMAP_CORE,
  JMAP_MAIL,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const config = {
  authType: "basic" as const,
  baseUrl: "https://mail.example.com",
  secret: "secret",
  username: "user@example.com",
};

const session = {
  accounts: { account: { isReadOnly: false, name: "User" } },
  apiUrl: "https://mail.example.com/jmap",
  capabilities: { [JMAP_CORE]: { maxSizeUpload: 50_000_000 } },
  downloadUrl: "https://mail.example.com/download",
  primaryAccounts: { [JMAP_MAIL]: "account" },
  uploadUrl: "https://mail.example.com/upload",
  username: "user@example.com",
};

const failureFrom = async (pending: Promise<unknown>): Promise<unknown> => {
  try {
    await pending;
    return null;
  } catch (error) {
    return error;
  }
};

beforeEach(() => {
  policyMocks.assertSafeProviderOrigin.mockReset();
  policyMocks.assertSafeProviderOrigin.mockImplementation(
    async (value: string) => new URL(value),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Stalwart final-request issue boundary", () => {
  it("does not cross the boundary for a pre-aborted request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const failure = new DOMException("cancelled", "AbortError");
    controller.abort(failure);
    const boundary: StalwartJmapRequestBoundary = { issued: false };

    await expect(
      new StalwartJmapClient(config).request(
        [],
        [JMAP_MAIL],
        controller.signal,
        boundary,
      ),
    ).rejects.toBe(failure);
    expect(boundary.issued).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not cross the boundary for origin/DNS preflight failure", async () => {
    const failure = new Error("Provider origin lookup failed.");
    policyMocks.assertSafeProviderOrigin
      .mockResolvedValueOnce(new URL(config.baseUrl))
      .mockRejectedValueOnce(failure);
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(session));
    vi.stubGlobal("fetch", fetchMock);
    const boundary: StalwartJmapRequestBoundary = { issued: false };

    await expect(
      new StalwartJmapClient(config).request(
        [],
        [JMAP_MAIL],
        undefined,
        boundary,
      ),
    ).rejects.toBe(failure);
    expect(boundary.issued).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rechecks cancellation immediately before crossing the boundary", async () => {
    const controller = new AbortController();
    const failure = new DOMException("cancelled during preflight", "AbortError");
    policyMocks.assertSafeProviderOrigin
      .mockImplementationOnce(async (value: string) => new URL(value))
      .mockImplementationOnce(async (value: string) => {
        controller.abort(failure);
        return new URL(value);
      });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(session));
    vi.stubGlobal("fetch", fetchMock);
    const boundary: StalwartJmapRequestBoundary = { issued: false };

    await expect(
      new StalwartJmapClient(config).request(
        [],
        [JMAP_MAIL],
        controller.signal,
        boundary,
      ),
    ).rejects.toBe(failure);
    expect(boundary.issued).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("crosses the boundary before final API transport loss", async () => {
    const failure = new Error("Final JMAP transport lost.");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockRejectedValueOnce(failure);
    vi.stubGlobal("fetch", fetchMock);
    const boundary: StalwartJmapRequestBoundary = { issued: false };

    await expect(
      new StalwartJmapClient(config).request(
        [],
        [JMAP_MAIL],
        undefined,
        boundary,
      ),
    ).rejects.toBe(failure);
    expect(boundary.issued).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404, 405, 409, 413, 415, 422, 429])(
    "keeps definitive final HTTP %s rejection retryable and sanitized",
    async (status) => {
      const privateDetail = "private-bcc@example.com retry-after-secret";
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(Response.json(session))
          .mockResolvedValueOnce(
            new Response(privateDetail, {
              headers: { "retry-after": privateDetail },
              status,
            }),
          ),
      );

      const failure = await failureFrom(
        submitStalwartMessage(
          new StalwartJmapClient(config),
          [],
          "draft",
        ),
      );

      expect(failure).toBeInstanceOf(StalwartJmapHttpError);
      expect(failure).toMatchObject({
        methodsWereNotExecuted: true,
        status,
      });
      expect(String(failure)).not.toContain(privateDetail);
      expect(failure).not.toHaveProperty("cause");
    },
  );

  it.each([408, 500, 502])(
    "returns uncertain for ambiguous final HTTP %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(Response.json(session))
          .mockResolvedValueOnce(
            new Response("private provider detail", { status }),
          ),
      );

      const receipt = await submitStalwartMessage(
        new StalwartJmapClient(config),
        [],
        "draft",
      );

      expect(receipt).toMatchObject({
        deliveryStatus: "uncertain",
        rejectedRecipients: [],
      });
      expect(JSON.stringify(receipt)).not.toContain("private provider detail");
    },
  );

  it("returns uncertain for issued final transport loss", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(session))
        .mockRejectedValueOnce(new Error("private transport detail")),
    );

    const receipt = await submitStalwartMessage(
      new StalwartJmapClient(config),
      [],
      "draft",
    );

    expect(receipt).toMatchObject({
      deliveryStatus: "uncertain",
      rejectedRecipients: [],
    });
    expect(JSON.stringify(receipt)).not.toContain("private transport detail");
  });
});
