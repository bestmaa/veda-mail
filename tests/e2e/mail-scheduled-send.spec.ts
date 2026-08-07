import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  mailSessionScopeHeaders,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const localInputValue = (hoursAhead: number): string => {
  const date = new Date(Date.now() + hoursAhead * 60 * 60 * 1_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const saveSendingPreferences = async (
  page: Parameters<typeof mailSessionScopeHeaders>[0],
  confirmBeforeSend: boolean,
  undoSendSeconds: 0 | 10,
) => {
  const headers = await mailSessionScopeHeaders(page);
  const response = await page.request.patch("/api/v1/mail/preferences", {
    data: {
      confirmBeforeSend, density: "comfortable", showPreview: true,
      keyboardShortcuts: false, sort: "newest", undoSendSeconds,
    },
    headers: { ...headers, origin: "http://127.0.0.1:3101" },
  });
  expect(response.ok()).toBe(true);
};

test.afterEach(async ({ page }) => {
  await saveSendingPreferences(page, false, 0);
});

test("schedules, lists, reschedules, and cancels a provider-backed draft", async ({ page }) => {
  await page.getByRole("button", { name: "New message" }).click();
  const composer = page.getByRole("dialog", { name: "Compose message" });
  await composer.getByRole("combobox", { exact: true, name: "To" })
    .fill("recipient@example.com");
  await composer.getByRole("textbox", { exact: true, name: "Subject" })
    .fill("Scheduled browser proof");
  await composer.getByRole("textbox", { exact: true, name: "Message body" })
    .fill("This provider-backed draft should remain durable.");
  await composer.getByRole("button", { name: "Schedule" }).click();

  const scheduleDialog = page.getByRole("dialog", { name: "Schedule send" });
  await expect(scheduleDialog).toBeVisible();
  await scheduleDialog.locator('input[type="datetime-local"]')
    .fill(localInputValue(2));
  await expectNoSeriousAccessibilityViolations(page);
  await scheduleDialog.getByRole("button", { name: "Schedule send" }).click();
  await expect(composer).toBeHidden();

  await page.getByRole("button", { name: /^Scheduled/u }).click();
  const manager = page.getByRole("dialog", { name: "Scheduled messages" });
  await expect(manager.getByText("Scheduled browser proof")).toBeVisible();
  await expect(manager.getByText("Scheduled", { exact: true })).toBeVisible();
  await expect(manager.getByText(/1 recipient/)).toBeVisible();

  await manager.getByRole("button", { name: "Reschedule" }).click();
  await manager.locator('input[type="datetime-local"]')
    .fill(localInputValue(3));
  await manager.getByRole("button", { name: "Save time" }).click();
  await expect(manager.locator('input[type="datetime-local"]')).toHaveCount(0);
  await expectNoSeriousAccessibilityViolations(page);

  await manager.getByRole("button", { name: "Cancel scheduled message" }).click();
  await expect(manager.getByText("No scheduled messages")).toBeVisible();
  await manager.getByRole("button", { name: "Close scheduled messages" }).click();
  await expect(manager).toBeHidden();
});

test("confirms, delays, atomically undoes, and restores the provider draft", async ({ page }) => {
  await saveSendingPreferences(page, true, 10);
  await page.reload();
  await page.getByRole("button", { name: "New message" }).click();
  let composer = page.getByRole("dialog", { name: "Compose message" });
  await composer.getByRole("combobox", { exact: true, name: "To" })
    .fill("undo-recipient@example.com");
  await composer.getByRole("textbox", { exact: true, name: "Subject" })
    .fill("Undo browser proof");
  await composer.getByRole("textbox", { exact: true, name: "Message body" })
    .fill("This exact provider draft must return after cancellation.");
  await expect(composer.getByText("Saved", { exact: true }).first()).toBeVisible();
  await composer.getByRole("button", { exact: true, name: "Send" }).click();

  const confirmation = page.getByRole("dialog", { name: "Send this message?" });
  await expect(confirmation).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await confirmation.getByRole("button", { exact: true, name: "Send" }).click();
  await expect(composer).toBeHidden();

  const notice = page.getByText("Message queued: Undo browser proof").locator("..");
  await expect(notice).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Undo" }).click();
  composer = page.getByRole("dialog", { name: "Compose message" });
  await expect(composer).toBeVisible();
  await expect(composer.getByRole("combobox", { exact: true, name: "To" }))
    .toHaveValue("undo-recipient@example.com");
  await expect(composer.getByRole("textbox", { exact: true, name: "Subject" }))
    .toHaveValue("Undo browser proof");
  await expect(composer.getByRole("textbox", { exact: true, name: "Message body" }))
    .toContainText("This exact provider draft must return after cancellation.");
});
