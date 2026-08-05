import { describe, expect, it } from "vitest";

import {
  nextConnectivityAfterFailure,
  nextConnectivityAfterSuccess,
} from "@/presentation/features/mail-workspace/mail-connectivity";

describe("mail connectivity transitions", () => {
  it("keeps ordinary successful refreshes quiet", () => {
    expect(nextConnectivityAfterSuccess("current")).toBe("current");
  });

  it.each(["offline", "reconnecting", "stale"] as const)(
    "announces restoration after %s",
    (phase) => expect(nextConnectivityAfterSuccess(phase)).toBe("restored"),
  );

  it("distinguishes browser offline state from online transport failure", () => {
    expect(nextConnectivityAfterFailure(false)).toBe("offline");
    expect(nextConnectivityAfterFailure(true)).toBe("stale");
  });
});
