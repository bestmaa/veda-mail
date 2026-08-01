import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  AmbiguousBulkMutationResultError,
  validateBulkMessageMutationResult,
} from "@/transport/client/bulk-message-mutation-result";

const first = id.message("message-a");
const second = id.message("message-b");

describe("bulk message mutation result validation", () => {
  it("returns a deterministic requested-ID partition", () => {
    expect(validateBulkMessageMutationResult({
      failed: [second],
      succeeded: [first],
    }, [first, second])).toEqual({ failed: [second], succeeded: [first] });
  });

  it("preserves an explicitly unconfirmed outcome", () => {
    expect(validateBulkMessageMutationResult({
      failed: [second],
      succeeded: [first],
      unconfirmed: [second],
    }, [first, second])).toEqual({
      failed: [], succeeded: [first], unconfirmed: [second],
    });
  });

  it.each([
    null,
    {},
    { failed: "message-a", succeeded: [second] },
    { failed: [first], succeeded: [first, second] },
    { failed: [], succeeded: [first] },
    { failed: [], succeeded: [first, first, second] },
    { failed: [], succeeded: [first, second, "unknown"] },
    { failed: [first], succeeded: [], unconfirmed: [second] },
  ])("rejects an incomplete or contradictory envelope", (value) => {
    expect(() => validateBulkMessageMutationResult(value, [first, second]))
      .toThrow(AmbiguousBulkMutationResultError);
  });
});
