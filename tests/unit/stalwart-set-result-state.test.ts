import { describe, expect, it } from "vitest";

import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  hasAdvancedJmapSetState,
  hasCreatedSubmissionState,
  hasUnchangedJmapSetState,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-set-state";

describe("Stalwart SetResponse state semantics", () => {
  it("accepts RFC-null result partitions", () => {
    expect(
      jmapSetResultSchema.safeParse({
        accountId: "account",
        created: null,
        destroyed: null,
        newState: "state-2",
        notCreated: null,
        notDestroyed: null,
        notUpdated: null,
        oldState: "state-1",
        updated: null,
      }).success,
    ).toBe(true);
  });

  it("distinguishes advancing success from unchanged rejection", () => {
    expect(
      hasAdvancedJmapSetState({ newState: "state-2", oldState: "state-1" }),
    ).toBe(true);
    expect(
      hasAdvancedJmapSetState({ newState: "state-1", oldState: "state-1" }),
    ).toBe(false);
    expect(
      hasUnchangedJmapSetState({ newState: "state-1", oldState: "state-1" }),
    ).toBe(true);
  });

  it("accepts Stalwart submission creation when oldState is omitted", () => {
    expect(hasCreatedSubmissionState({ newState: "state-2" })).toBe(true);
    expect(
      hasCreatedSubmissionState({ newState: "state-1", oldState: "state-1" }),
    ).toBe(false);
    expect(hasCreatedSubmissionState({ oldState: "state-1" })).toBe(false);
  });
});
