import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

test("imports multiple RFC 5322 .eml files into one authorized mailbox", async ({ page }) => {
  await page.getByRole("button", { name: /Open account settings/ }).click();
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  const section = dialog.getByRole("heading", { name: "Import mail" })
    .locator("..").locator("..").locator("..");
  await expect(section).toBeVisible();
  await section.getByLabel("Destination mailbox").selectOption({ label: "Inbox" });
  const responses: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/mail/messages/import?") &&
        response.request().method() === "POST") responses.push(response.status());
  });
  await section.locator('input[type="file"]').setInputFiles([
    {
      buffer: Buffer.from("From: one@example.com\r\nTo: member@example.com\r\nSubject: Imported one\r\n\r\nHello one.\r\n"),
      mimeType: "message/rfc822",
      name: "one.eml",
    },
    {
      buffer: Buffer.from("From: two@example.com\r\nTo: member@example.com\r\nSubject: Imported two\r\n\r\nHello two.\r\n"),
      mimeType: "message/rfc822",
      name: "two.eml",
    },
  ]);
  await expect(section.getByRole("status")).toHaveText("2 messages imported.");
  expect(responses).toEqual([201, 201]);
  await expectNoSeriousAccessibilityViolations(page);
});
