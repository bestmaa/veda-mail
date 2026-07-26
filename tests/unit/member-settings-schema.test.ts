import { describe, expect, it } from "vitest";

import {
  memberPasswordChangeSchema,
  memberProfileUpdateSchema,
} from "@/transport/http/request-schemas";

describe("member settings validation", () => {
  it("normalizes a safe profile name", () => {
    expect(
      memberProfileUpdateSchema.parse({ displayName: "  Keyur Borkar  " }),
    ).toEqual({ displayName: "Keyur Borkar" });
  });

  it("requires matching passwords", () => {
    expect(() =>
      memberPasswordChangeSchema.parse({
        confirmPassword: "different-password",
        currentPassword: "old-password",
        newPassword: "new-password",
      }),
    ).toThrow("New passwords do not match");
  });

  it("does not return the confirmation field", () => {
    expect(
      memberPasswordChangeSchema.parse({
        confirmPassword: "new-password",
        currentPassword: "old-password",
        newPassword: "new-password",
        otpCode: "123456",
      }),
    ).toEqual({
      currentPassword: "old-password",
      newPassword: "new-password",
      otpCode: "123456",
    });
  });
});
