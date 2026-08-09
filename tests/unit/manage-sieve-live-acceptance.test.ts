import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const entry = "scripts/manage-sieve-live-acceptance.mjs";

describe("ManageSieve live acceptance runner", () => {
  it("fails closed before mutation when management access is absent", () => {
    const result = spawnSync(process.execPath, [entry], {
      encoding: "utf8",
      env: {
        ...process.env,
        VEDA_MAIL_STALWART_MANAGEMENT_API_KEY: "",
        VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN: "",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Stalwart management access is required.");
  });

  it("rejects a non-HTTPS management origin without disclosing its key", () => {
    const secret = "acceptance-secret-that-must-not-be-printed";
    const result = spawnSync(process.execPath, [entry], {
      encoding: "utf8",
      env: {
        ...process.env,
        VEDA_MAIL_STALWART_MANAGEMENT_API_KEY: secret,
        VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN: "http://mail.example.test",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must be an HTTPS origin");
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
  });

  it("ships the runner and helpers in the production image", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");

    expect(dockerfile).toContain(
      "/app/scripts/manage-sieve-live-acceptance.mjs ./scripts/manage-sieve-live-acceptance.mjs",
    );
    expect(dockerfile).toContain(
      "/app/scripts/manage-sieve-live ./scripts/manage-sieve-live",
    );
  });
});
