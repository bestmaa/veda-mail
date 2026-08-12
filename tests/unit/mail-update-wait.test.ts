import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isActive: vi.fn(),
  resolveGateway: vi.fn(),
}));

vi.mock("@/server/connections/connection-store", () => ({
  connectionStore: { isActiveAsync: mocks.isActive },
}));
vi.mock("@/server/mail/gateway-cache", () => ({
  resolveGateway: mocks.resolveGateway,
}));

import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { waitForMailUpdate } from "@/server/mail/mail-update-wait";

const connection = (suffix: string): ProviderConnection => ({
  config: {},
  createdAt: "2026-08-05T00:00:00.000Z",
  displayName: "Test",
  id: id.connection(`update-${suffix}`),
  providerId: id.provider("mock"),
});

beforeEach(() => {
  mocks.isActive.mockReset().mockReturnValue(true);
  mocks.resolveGateway.mockReset();
});

describe("mail update wait coordinator", () => {
  it("shares one provider wait across concurrent requests", async () => {
    let release!: () => void;
    const providerWait = new Promise<void>((resolve) => { release = resolve; });
    const providerWaitFn = vi.fn(async () => {
      await providerWait;
      return { mode: "push" as const, retryAfterMs: 10, shouldRefresh: true };
    });
    mocks.resolveGateway.mockResolvedValue({ waitForMailUpdate: providerWaitFn });
    const current = connection("single-flight");

    const first = waitForMailUpdate(current);
    const second = waitForMailUpdate(current);
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { mode: "push", retryAfterMs: 1_000, shouldRefresh: true },
      { mode: "push", retryAfterMs: 1_000, shouldRefresh: true },
    ]);
    expect(providerWaitFn).toHaveBeenCalledOnce();
  });

  it("rejects a result after its member session expires", async () => {
    mocks.resolveGateway.mockResolvedValue({
      waitForMailUpdate: async () => ({
        mode: "poll" as const, retryAfterMs: 60_000, shouldRefresh: true,
      }),
    });
    mocks.isActive.mockReturnValue(false);

    await expect(waitForMailUpdate(connection("expired"))).rejects.toMatchObject({
      code: "MEMBER_SESSION_EXPIRED",
      status: 401,
    });
  });
});
