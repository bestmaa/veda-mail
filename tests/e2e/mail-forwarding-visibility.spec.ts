import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

test("member can see but cannot control administrator-managed forwarding", async ({
  page,
}) => {
  await page.route("**/api/v1/member/forwarding", async (route) => {
    await route.fulfill({ json: { data: {
      destinationEmail: "member.archive@gmail.com", enabled: true,
      keepLocalCopy: true, status: "active",
    } } });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "New message" })).toBeEnabled();

  await page.getByRole("button", { name: /Open account settings/ }).click();
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  const forwarding = dialog.getByRole("region", {
    name: "Administrator-managed forwarding",
  });
  await expect(forwarding).toContainText("member.archive@gmail.com");
  await expect(forwarding).toContainText("A copy stays in this mailbox");
  await expect(forwarding).toContainText("Status: active");
  await expect(forwarding.getByRole("button")).toHaveCount(0);
  await expect(forwarding.locator("input, select, textarea")).toHaveCount(0);
  await expectNoSeriousAccessibilityViolations(page);
});
