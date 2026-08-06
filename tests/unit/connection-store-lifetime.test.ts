import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearDeliveryNotices: vi.fn(),
  clearGateway: vi.fn(),
  clearSendIdempotency: vi.fn(),
  clearTwoFactorEnrollment: vi.fn(),
}));

vi.mock("@/server/auth/two-factor-enrollment", () => ({
  twoFactorEnrollmentStore: { remove: mocks.clearTwoFactorEnrollment },
}));
vi.mock("@/server/mail/gateway-cache", () => ({
  clearGateway: mocks.clearGateway,
}));
vi.mock("@/server/mail/delivery-notice-store", () => ({
  deliveryNoticeStore: {
    append: vi.fn(() => true),
    clear: mocks.clearDeliveryNotices,
    clearAll: vi.fn(),
  },
}));
vi.mock("@/server/mail/send-idempotency-store", () => ({
  sendIdempotencyStore: {
    begin: vi.fn(() => ({ kind: "capacity" })),
    clear: mocks.clearSendIdempotency,
    clearAll: vi.fn(),
  },
}));

import type { ProviderConnection } from "@/domain/provider/provider";
import type { ConnectionId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import {
  MEMBER_CONNECTION_IDLE_TTL_MS,
  MEMBER_CONNECTION_TTL_MS,
} from "@/server/connections/connection-lifetime";
import { connectionStore } from "@/server/connections/connection-store";

interface TestConnectionState {
  readonly connections: Map<
    ConnectionId,
    {
      readonly connection: ProviderConnection;
      readonly deliveryNoticeCapacityWarning: boolean;
      readonly profileRevision: string;
    }
  >;
}

const state = (): TestConnectionState =>
  (globalThis as typeof globalThis & {
    __vedaMailConnections: TestConnectionState;
  }).__vedaMailConnections;

const createConnection = (providerId = "mock") =>
  connectionStore.create(
    {
      config: { credential: "secret" },
      displayName: "Member mailbox",
      providerId: id.provider(providerId),
    },
    "profile-revision",
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
  connectionStore.clearAll();
  vi.clearAllMocks();
});

afterEach(() => {
  connectionStore.clearAll();
  vi.useRealTimers();
});

describe("connection store lifetime", () => {
  it.each(["mock", "imap-smtp", "stalwart-jmap"])(
    "evicts an idle %s connection and its secrets at the exact deadline",
    (providerId) => {
      const connection = createConnection(providerId);

      vi.advanceTimersByTime(MEMBER_CONNECTION_IDLE_TTL_MS - 1);
      expect(state().connections.has(connection.id)).toBe(true);
      expect(connectionStore.isActive(connection)).toBe(true);

      vi.advanceTimersByTime(1);
      expect(state().connections.has(connection.id)).toBe(false);
      expect(connectionStore.isActive(connection)).toBe(false);
      expect(mocks.clearGateway).toHaveBeenCalledWith(connection.id);
      expect(mocks.clearDeliveryNotices).toHaveBeenCalledWith(connection.id);
      expect(mocks.clearSendIdempotency).toHaveBeenCalledWith(connection.id);
      expect(mocks.clearTwoFactorEnrollment).toHaveBeenCalledWith(
        connection.id,
      );
    },
  );

  it("touches activity but never extends the twelve-hour absolute lifetime", () => {
    const connection = createConnection();
    for (let elapsed = 0; elapsed < MEMBER_CONNECTION_TTL_MS; elapsed += 20 * 60_000) {
      vi.advanceTimersByTime(Math.min(20 * 60_000, MEMBER_CONNECTION_TTL_MS - elapsed - 1));
      if (Date.now() < Date.parse(connection.createdAt) + MEMBER_CONNECTION_TTL_MS) {
        expect(connectionStore.get(connection.id)).not.toBeNull();
      }
    }

    vi.setSystemTime(Date.parse(connection.createdAt) + MEMBER_CONNECTION_TTL_MS);
    expect(connectionStore.get(connection.id)).toBeNull();
  });

  it("cancels scheduled cleanup when a connection is removed early", () => {
    const connection = createConnection();
    connectionStore.remove(connection.id);
    vi.clearAllMocks();

    vi.advanceTimersByTime(MEMBER_CONNECTION_TTL_MS);

    expect(mocks.clearGateway).not.toHaveBeenCalled();
    expect(mocks.clearTwoFactorEnrollment).not.toHaveBeenCalled();
  });

  it("lists only sessions belonging to the requested opaque owner", () => {
    connectionStore.create(
      {
        config: { credential: "first-secret" },
        displayName: "First mailbox",
        providerId: id.provider("mock"),
      },
      "profile-revision",
      { clientLabel: "Chrome on Linux", ownerKey: "owner-a" },
    );
    connectionStore.create(
      {
        config: { credential: "second-secret" },
        displayName: "Second mailbox",
        providerId: id.provider("mock"),
      },
      "profile-revision",
      { clientLabel: "Firefox on Linux", ownerKey: "owner-b" },
    );

    const sessions = connectionStore.listForOwner("owner-a");

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.clientLabel).toBe("Chrome on Linux");
    expect(sessions[0]?.connection.config).toEqual({ credential: "first-secret" });
  });

  it("keeps explicit removal idempotent for orphaned connection resources", () => {
    const connectionId = id.connection("orphaned-connection");

    connectionStore.remove(connectionId);

    expect(mocks.clearGateway).toHaveBeenCalledWith(connectionId);
    expect(mocks.clearDeliveryNotices).toHaveBeenCalledWith(connectionId);
    expect(mocks.clearSendIdempotency).toHaveBeenCalledWith(connectionId);
    expect(mocks.clearTwoFactorEnrollment).toHaveBeenCalledWith(connectionId);
  });

  it("fails closed without blocking healthy sessions when state is corrupt", () => {
    const corrupt = createConnection();
    const healthy = createConnection();
    const stored = state().connections.get(corrupt.id);
    expect(stored).toBeDefined();
    if (!stored) throw new Error("Expected a stored connection.");
    state().connections.set(corrupt.id, {
      ...stored,
      connection: { ...corrupt, createdAt: "invalid" },
    });

    expect(connectionStore.get(healthy.id)?.connection).toEqual(healthy);
    expect(connectionStore.get(corrupt.id)).toBeNull();
    expect(mocks.clearGateway).toHaveBeenCalledWith(corrupt.id);
  });
});
