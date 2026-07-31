import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SendReceipt } from "@/domain/mail/mail";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  getCurrentConnection: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));

vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { GET } from "@/app/api/v1/mail/delivery-notices/route";
import { connectionStore } from "@/server/connections/connection-store";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import {
  DELIVERY_NOTICE_OVERFLOW_MESSAGE,
  deliveryNoticeStore,
  MAX_DELIVERY_NOTICE_CONNECTIONS,
} from "@/server/mail/delivery-notice-store";

const origin = "https://mail.example.com";
let refusedConnection: ProviderConnection;
let unrelatedConnection: ProviderConnection;

const receipt = (index: number): SendReceipt => ({
  deliveryNoticeId: `00000000-0000-4000-8000-${index
    .toString(16)
    .padStart(12, "0")}`,
  deliveryStatus: "uncertain",
  id: id.message(`capacity-message-${index}`),
  rejectedRecipients: [],
  submittedAt: "2026-07-30T12:00:00.000Z",
});

const request = (connection: ProviderConnection): Request =>
  new Request(`${origin}/api/v1/mail/delivery-notices`, {
    headers: {
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": mailSessionScope(connection),
    },
  });

const createConnection = (displayName: string): ProviderConnection =>
  connectionStore.create(
    { config: {}, displayName, providerId: id.provider("mock") },
    "notice-capacity-revision",
  );

const fillNoticeBuckets = (): void => {
  for (let index = 0; index < MAX_DELIVERY_NOTICE_CONNECTIONS; index += 1) {
    deliveryNoticeStore.append(
      id.connection(`occupied-notice-${index}`),
      receipt(index),
    );
  }
};

beforeEach(() => {
  connectionStore.clearAll();
  refusedConnection = createConnection("Refused connection");
  unrelatedConnection = createConnection("Unrelated connection");
  mocks.getCurrentConnection.mockReset();
  mocks.assertRequestRateLimit.mockReset();
  mocks.assertSubjectRateLimit.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("delivery notice connection-scoped capacity warning", () => {
  it("warns only the refused connection and preserves it across config update", async () => {
    fillNoticeBuckets();
    expect(
      connectionStore.appendDeliveryNoticeIfActive(
        refusedConnection,
        receipt(MAX_DELIVERY_NOTICE_CONNECTIONS),
      ),
    ).toBe(false);
    mocks.getCurrentConnection.mockResolvedValue(refusedConnection);

    const first = await GET(request(refusedConnection));
    const repeated = await GET(request(refusedConnection));
    const warning = {
      data: {
        notices: [
          {
            kind: "overflow",
            message: DELIVERY_NOTICE_OVERFLOW_MESSAGE,
          },
        ],
      },
    };
    await expect(first.json()).resolves.toEqual(warning);
    await expect(repeated.json()).resolves.toEqual(warning);

    const updated = connectionStore.updateConfig(refusedConnection.id, {
      username: "member@example.com",
    });
    mocks.getCurrentConnection.mockResolvedValue(updated);
    await expect((await GET(request(updated))).json()).resolves.toEqual(
      warning,
    );

    mocks.getCurrentConnection.mockResolvedValue(unrelatedConnection);
    await expect(
      (await GET(request(unrelatedConnection))).json(),
    ).resolves.toEqual({ data: { notices: [] } });
  });

  it("clears the warning on removal, reset, and natural session expiry", () => {
    fillNoticeBuckets();
    connectionStore.appendDeliveryNoticeIfActive(
      refusedConnection,
      receipt(MAX_DELIVERY_NOTICE_CONNECTIONS),
    );
    expect(
      connectionStore.hasDeliveryNoticeCapacityWarning(refusedConnection),
    ).toBe(true);

    connectionStore.remove(refusedConnection.id);
    expect(
      connectionStore.hasDeliveryNoticeCapacityWarning(refusedConnection),
    ).toBe(false);

    refusedConnection = createConnection("Reset connection");
    deliveryNoticeStore.clearAll();
    fillNoticeBuckets();
    connectionStore.appendDeliveryNoticeIfActive(
      refusedConnection,
      receipt(MAX_DELIVERY_NOTICE_CONNECTIONS + 1),
    );
    connectionStore.clearAll();
    expect(
      connectionStore.hasDeliveryNoticeCapacityWarning(refusedConnection),
    ).toBe(false);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T00:00:00.000Z"));
    refusedConnection = createConnection("Expiring connection");
    fillNoticeBuckets();
    connectionStore.appendDeliveryNoticeIfActive(
      refusedConnection,
      receipt(MAX_DELIVERY_NOTICE_CONNECTIONS + 2),
    );
    vi.advanceTimersByTime(12 * 60 * 60 * 1_000 + 1);
    expect(
      connectionStore.hasDeliveryNoticeCapacityWarning(refusedConnection),
    ).toBe(false);
  });
});
