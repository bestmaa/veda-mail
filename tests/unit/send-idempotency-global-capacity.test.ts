import { beforeEach, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  MAX_SEND_IDEMPOTENCY_CONNECTIONS,
  MAX_SEND_IDEMPOTENCY_GLOBAL,
  sendIdempotencyStore,
} from "@/server/mail/send-idempotency-store";

const connection = (index: number) => id.connection(`global-${index}`);
const draft = (index: number) => id.draft(`global-draft-${index}`);
const fingerprint = (index: number) =>
  index.toString(16).padStart(64, "0");
const expiry = (): number => Date.now() + 60 * 60 * 1_000;

const complete = (connectionIndex: number, entryIndex: number): void => {
  const begun = sendIdempotencyStore.begin(
    connection(connectionIndex),
    draft(entryIndex),
    fingerprint(entryIndex),
    expiry(),
  );
  if (begun.kind !== "owner") throw new Error("Expected send ownership.");
  sendIdempotencyStore.complete(
    connection(connectionIndex),
    draft(entryIndex),
    begun.token,
    {
      deliveryStatus: "accepted",
      id: id.message(`message-${entryIndex}`),
      rejectedRecipients: [],
      submittedAt: "2026-07-30T12:00:00.000Z",
    },
  );
};

beforeEach(() => {
  sendIdempotencyStore.clearAll();
});

describe("send idempotency global capacity", () => {
  it("caps connection buckets without evicting existing state", () => {
    for (
      let index = 0;
      index < MAX_SEND_IDEMPOTENCY_CONNECTIONS;
      index += 1
    ) {
      complete(index, index);
    }

    expect(
      sendIdempotencyStore.begin(
        connection(MAX_SEND_IDEMPOTENCY_CONNECTIONS),
        draft(20_000),
        fingerprint(20_000),
        expiry(),
      ),
    ).toEqual({ kind: "capacity" });
    expect(
      sendIdempotencyStore.begin(
        connection(0),
        draft(0),
        fingerprint(0),
        expiry(),
      ).kind,
    ).toBe("replay");
    expect(
      sendIdempotencyStore.begin(
        connection(0),
        draft(20_000),
        fingerprint(20_000),
        expiry(),
      ).kind,
    ).toBe("owner");
  });

  it("caps total entries without evicting an existing replay", () => {
    const entriesPerConnection = 10;
    for (let index = 0; index < MAX_SEND_IDEMPOTENCY_GLOBAL; index += 1) {
      complete(Math.floor(index / entriesPerConnection), index);
    }

    expect(
      sendIdempotencyStore.begin(
        connection(0),
        draft(30_000),
        fingerprint(30_000),
        expiry(),
      ),
    ).toEqual({ kind: "capacity" });
    expect(
      sendIdempotencyStore.begin(
        connection(0),
        draft(0),
        fingerprint(0),
        expiry(),
      ).kind,
    ).toBe("replay");
  });

  it("allows the same draft key independently across connections", () => {
    const sharedDraft = draft(40_000);
    const first = sendIdempotencyStore.begin(
      connection(0),
      sharedDraft,
      fingerprint(40_000),
      expiry(),
    );
    const second = sendIdempotencyStore.begin(
      connection(1),
      sharedDraft,
      fingerprint(40_000),
      expiry(),
    );

    expect(first.kind).toBe("owner");
    expect(second.kind).toBe("owner");
  });
});
