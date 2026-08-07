import { expect, test } from "@playwright/test";

import type { MessageListPreferences } from "@/domain/mail/message-list-preferences";

import {
  expectNoSeriousAccessibilityViolations,
  mailSessionScopeHeaders,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const defaults: MessageListPreferences = {
  confirmBeforeSend: false,
  density: "comfortable",
  keyboardShortcuts: false,
  locale: "en-IN",
  showPreview: true,
  sort: "newest",
  timeZone: "auto",
  undoSendSeconds: 0,
};

const savePreferences = async (
  page: Parameters<typeof mailSessionScopeHeaders>[0],
  preferences: MessageListPreferences,
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
  const trigger = page.getByRole("button", { name: "Mailbox preferences" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Mailbox preferences" });
  await expect(dialog).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  await dialog.getByText("Compact", { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Compact" })).toBeChecked();
  await dialog.getByRole("combobox", { name: "Sort order" }).selectOption("oldest");
  await dialog.getByRole("checkbox", { name: "Show message preview text" }).uncheck();
  await dialog.getByRole("combobox", { name: "Undo send window" }).selectOption("10");
  await dialog.getByRole("checkbox", {
    name: "Ask for confirmation before sending",
  }).check();
  await dialog.getByRole("checkbox", {
    name: "Enable single-key mailbox shortcuts",
  }).check();
  await dialog.getByRole("combobox", {
    name: "Formatting locale and reading direction",
  }).selectOption("ar");
  await dialog.getByRole("combobox", { name: "Time zone" })
    .selectOption("Asia/Riyadh");
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
  await expect(page.locator("html")).toHaveAttribute("data-mail-locale", "ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.setViewportSize({ height: 720, width: 320 });
  const reflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(reflow.scrollWidth).toBeLessThanOrEqual(reflow.clientWidth + 1);
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
  await expect(dialog.getByRole("combobox", { name: "Undo send window" }))
    .toHaveValue("10");
  await expect(dialog.getByRole("checkbox", {
    name: "Ask for confirmation before sending",
  })).toBeChecked();
  await expect(dialog.getByRole("checkbox", {
    name: "Enable single-key mailbox shortcuts",
  })).toBeChecked();
  await expect(dialog.getByRole("combobox", {
    name: "Formatting locale and reading direction",
  })).toHaveValue("ar");
  await expect(dialog.getByRole("combobox", { name: "Time zone" }))
    .toHaveValue("Asia/Riyadh");
});

test("recipient Enter never opens send confirmation", async ({ page }) => {
  await savePreferences(page, {
    ...defaults,
    confirmBeforeSend: true,
    undoSendSeconds: 20,
  });
  await page.reload();
  await page.getByRole("button", { name: "New message" }).click();
  const composer = page.getByRole("dialog", { name: "Compose message" });
  const recipient = composer.getByRole("combobox", { name: "To" });

  await recipient.fill("person@example.com");
  await recipient.press("Enter");

  await expect(composer).toBeVisible();
  await expect(recipient).toHaveValue("person@example.com");
  await expect(page.getByRole("dialog", { name: "Send this message?" }))
    .toHaveCount(0);
});
