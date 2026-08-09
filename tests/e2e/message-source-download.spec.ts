import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("serves the authenticated mock provider source route", async ({ page }) => {
  await page.getByRole("button", { name: "Open Revised product roadmap · Q3" }).click();
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/mail/messages/msg-roadmap/source"),
  );
  await page.getByRole("button", {
    name: "Download original message (.eml)",
  }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("message/rfc822");
});

test("downloads the selected original message as RFC 5322", async ({ page }) => {
  const expected = [
    "Subject: Revised product roadmap · Q3",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Original body",
  ].join("\r\n");
  await page.route("**/api/v1/mail/messages/msg-roadmap/source", async (route) => {
    await route.fulfill({
      body: expected,
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": 'attachment; filename="message.eml"',
        "content-length": String(new TextEncoder().encode(expected).byteLength),
        "content-type": "message/rfc822",
      },
      status: 200,
    });
  });
  await page.getByRole("button", { name: "Open Revised product roadmap · Q3" }).click();
  const action = page.getByRole("button", {
    name: "Download original message (.eml)",
  });
  await expect(action).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    action.click(),
  ]);

  expect(download.suggestedFilename()).toBe("message.eml");
  const path = await download.path();
  expect(path).not.toBeNull();
  const source = await readFile(path ?? "", "utf8");
  expect(source).toBe(expected);
});
