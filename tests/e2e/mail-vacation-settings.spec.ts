import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

test("saves and reloads an automatic vacation reply", async ({ page }) => {
  await page.getByRole("button", { name: /Open account settings/ }).click();
  let dialog = page.getByRole("dialog", { name: "Account settings" });
  let form = dialog.locator("form").filter({ hasText: "Automatic vacation reply" });

  await expect(form.getByText("Provider-managed out-of-office response"))
    .toBeVisible();
  await form.getByLabel("Send an automatic reply").check();
  await form.getByLabel("Subject").fill("Away from the office");
  await form.getByLabel("Message").fill("I will reply when I return.");

  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/v1/member/vacation") &&
    candidate.request().method() === "PUT",
  );
  await form.getByRole("button", { name: "Save automatic reply" }).click();
  expect((await response).ok()).toBe(true);
  await expect(form.getByRole("status"))
    .toHaveText("Automatic reply settings saved.");

  await dialog.locator("[data-settings-initial-focus]").click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: /Open account settings/ }).click();
  dialog = page.getByRole("dialog", { name: "Account settings" });
  form = dialog.locator("form").filter({ hasText: "Automatic vacation reply" });
  await expect(form.getByLabel("Send an automatic reply")).toBeChecked();
  await expect(form.getByLabel("Subject")).toHaveValue("Away from the office");
  await expect(form.getByLabel("Message"))
    .toHaveValue("I will reply when I return.");
  await expect(form.getByText(/^Mail delegation:/))
    .toContainText("does not advertise a supported mail-delegation capability");
  await expectNoSeriousAccessibilityViolations(page);
});
