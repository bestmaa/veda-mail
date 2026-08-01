import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  mailSessionScopeHeaders,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const defaults = {
  density: "comfortable",
  showPreview: true,
  sort: "newest",
} as const;

const savePreferences = async (
  page: Parameters<typeof mailSessionScopeHeaders>[0],
  preferences: typeof defaults,
) => {
  const scope = await mailSessionScopeHeaders(page);
  const response = await page.request.patch("/api/v1/mail/preferences", {
    data: preferences,
    headers: { ...scope, origin: "http://127.0.0.1:3101" },
  });
  expect(response.ok()).toBe(true);
};

test.beforeEach(async ({ page }) => {
  await savePreferences(page, defaults);
  await page.reload();
});

test.afterEach(async ({ page }) => {
  await savePreferences(page, defaults);
});

test("persists accessible density, sort, and preview controls", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Message list options" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Message list options" });
  await expect(dialog).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  await dialog.getByText("Compact", { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Compact" })).toBeChecked();
  await dialog.getByRole("combobox", { name: "Sort order" }).selectOption("oldest");
  await dialog.getByRole("checkbox", { name: "Show message preview text" }).uncheck();
  const refresh = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/v1/mail/workspace" &&
      url.searchParams.get("sort") === "oldest" &&
      url.searchParams.get("preview") === "hide";
  });
  await dialog.getByRole("button", { name: "Save" }).click();
  await refresh;

  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator('[data-density="compact"]')).toBeVisible();
  await expect(page.getByText(
    "Your private mail stack is ready. Here are the next security checks.",
  )).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-density="compact"]')).toBeVisible();
  await trigger.click();
  await expect(dialog.getByRole("radio", { name: "Compact" })).toBeChecked();
  await expect(dialog.getByRole("combobox", { name: "Sort order" })).toHaveValue("oldest");
  await expect(dialog.getByRole("checkbox", {
    name: "Show message preview text",
  })).not.toBeChecked();
});
