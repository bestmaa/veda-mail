import { expect, test } from "@playwright/test";
import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

test("shows provider-supported and unavailable mail features", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: /Open profile settings/ })
    .click();

  const dialog = page.getByRole("dialog", {
    name: "Profile & security",
  });
  await expect(
    dialog.getByRole("heading", { name: "Provider capabilities" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("listitem").filter({ hasText: "Server-side search" }),
  ).toContainText("Available");
  await expect(
    dialog.getByRole("listitem").filter({ hasText: "Provider draft sync" }),
  ).toContainText("Not available");
  await expect(
    dialog.getByRole("listitem").filter({ hasText: "Live mailbox updates" }),
  ).toContainText("Manual refresh");
  await expect(
    dialog.getByRole("listitem").filter({ hasText: "Attachments" }),
  ).toContainText("Not available");

  await expectNoSeriousAccessibilityViolations(page);
});
