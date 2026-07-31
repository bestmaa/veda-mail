import { describe, expect, it } from "vitest";

import { isAdminSessionUnauthorized } from "@/presentation/features/admin-mail-users/admin-mail-users-errors";
import { ApiClientError } from "@/transport/client/api-request";

describe("admin mailbox user client errors", () => {
  it("redirects only for an expired administrator session", () => {
    expect(
      isAdminSessionUnauthorized(
        new ApiClientError("Sign in.", 401, "ADMIN_UNAUTHORIZED"),
      ),
    ).toBe(true);
    expect(
      isAdminSessionUnauthorized(
        new ApiClientError(
          "Administrator verification failed.",
          401,
          "ADMIN_STEP_UP_REJECTED",
        ),
      ),
    ).toBe(false);
    expect(
      isAdminSessionUnauthorized(
        new ApiClientError(
          "Enter an authenticator or backup code.",
          401,
          "ADMIN_SECOND_FACTOR_REQUIRED",
        ),
      ),
    ).toBe(false);
    expect(isAdminSessionUnauthorized(new Error("Network error"))).toBe(false);
  });
});
