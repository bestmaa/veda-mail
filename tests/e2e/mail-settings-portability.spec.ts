import { expect, test } from "@playwright/test";
import type { Download } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const readDownload = async (download: Download): Promise<string> => {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Settings download stream is unavailable.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

test("exports and explicitly replaces portable settings and rules", async ({ page }) => {
  await page.getByRole("button", { name: /Open account settings/ }).click();
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  const section = dialog.getByRole("heading", { name: "Settings portability" })
    .locator("..").locator("..").locator("..");
  await expect(section).toBeVisible();

  const downloadEvent = page.waitForEvent("download");
  await section.getByRole("button", { name: "Export settings" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("veda-mail-settings.json");
  const exported = JSON.parse(await readDownload(download));
  expect(exported).toMatchObject({ format: "veda-mail/settings", version: 1 });
  expect(JSON.stringify(exported)).not.toContain("provider-inbox");

  const imported = {
    ...exported,
    preferences: { ...exported.preferences, density: "compact" },
    rules: [],
  };
  await section.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from(JSON.stringify(imported)),
    mimeType: "application/json",
    name: "portable-settings.json",
  });
  await expect(section.getByText(/Current preferences and rules will be replaced/))
    .toBeVisible();
  const importResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/member/portability/settings") &&
    response.request().method() === "POST",
  );
  await section.getByRole("button", { name: "Replace and import" }).click();
  expect((await importResponse).status()).toBe(200);
  await expect(section.getByRole("status"))
    .toHaveText("Settings and rules imported and deployed.");
  await expectNoSeriousAccessibilityViolations(page);
});
