import { describe, expect, it } from "vitest";

import { memberSessionClientLabel } from "@/server/connections/member-session-metadata";

describe("member session client metadata", () => {
  it("returns a coarse browser and platform label without preserving the user agent", () => {
    const request = new Request("https://mail.example.com", {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 secret-extension/9",
      },
    });

    const label = memberSessionClientLabel(request);

    expect(label).toBe("Chrome on Windows");
    expect(label).not.toContain("secret-extension");
  });
});
