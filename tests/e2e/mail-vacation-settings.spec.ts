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
  await expect(dialog.getByText("Automatic reply settings saved.", { exact: true }))
    .toBeVisible();

  await dialog.locator("[data-settings-initial-focus]").click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: /Open account settings/ }).click();
  dialog = page.getByRole("dialog", { name: "Account settings" });
  form = dialog.locator("form").filter({ hasText: "Automatic vacation reply" });
  await expect(form.getByLabel("Send an automatic reply")).toBeChecked();
  await expect(form.getByLabel("Subject")).toHaveValue("Away from the office");
  await expect(form.getByLabel("Message"))
    .toHaveValue("I will reply when I return.");
  const delegation = dialog.locator("form").filter({ hasText: "Inbox delegation" });
  await delegation.getByLabel("Account identifier").fill("delegate@example.com");
  await delegation.getByLabel("Access").selectOption("manage");
  const delegated = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/v1/member/delegation") &&
    candidate.request().method() === "PUT",
  );
  await delegation.getByRole("button", { name: "Grant access" }).click();
  expect((await delegated).ok()).toBe(true);
  await expect(delegation.getByText(/delegate@example\.com/)).toContainText("Manage mail");
  const removed = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/v1/member/delegation") &&
    candidate.request().method() === "DELETE",
  );
  await delegation.getByRole("button", { name: "Remove" }).click();
  expect((await removed).ok()).toBe(true);
  await expect(delegation.getByText("No Inbox delegates.")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});
