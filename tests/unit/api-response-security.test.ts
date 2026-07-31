import { describe, expect, it, vi } from "vitest";

import {
  API_ERROR_CODE_HEADER,
  ApiError,
} from "@/transport/http/api-error";
import { apiFailure } from "@/transport/http/api-response";

describe("API failure responses", () => {
  it("does not expose unexpected internal error messages", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = apiFailure(
      new Error("EACCES: /data/private/installation.json"),
      "Unable to save settings.",
    );
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "REQUEST_FAILED",
        message: "Unable to save settings.",
      },
    });
    expect(consoleError).toHaveBeenCalledOnce();
    expect(response.headers.get(API_ERROR_CODE_HEADER)).toBe("REQUEST_FAILED");
    consoleError.mockRestore();
  });

  it("preserves deliberate public API errors", async () => {
    const response = apiFailure(
      new ApiError("Try again later.", "RATE_LIMITED", 429),
    );
    await expect(response.json()).resolves.toEqual({
      error: { code: "RATE_LIMITED", message: "Try again later." },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get(API_ERROR_CODE_HEADER)).toBe("RATE_LIMITED");
  });
});
