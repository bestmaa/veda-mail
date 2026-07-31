import { expect, test } from "@playwright/test";
import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

test("shows provider-supported and unavailable mail features", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Open account settings/ }).click();

  const dialog = page.getByRole("dialog", {
    name: "Account settings",
  });
  await expect(
    dialog.getByRole("heading", { name: "Provider capabilities" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("listitem").filter({ hasText: "Server-side search" }),
  ).toContainText("Available");
  await expect(
    dialog.getByRole("listitem").filter({ hasText: "Manual provider drafts" }),
  ).toContainText("Available");
  await expect(
    dialog.getByRole("listitem").filter({ hasText: "Live mailbox updates" }),
  ).toContainText("Manual refresh");
  await expect(
    dialog
      .getByRole("listitem")
      .filter({ hasText: "Attachment upload & send" }),
  ).toContainText("Up to 18.0 MB");
  await expect(
    dialog
      .getByRole("listitem")
      .filter({ hasText: "Received attachment downloads" }),
  ).toContainText("Up to 50.0 MB");

  await expectNoSeriousAccessibilityViolations(page);
});
