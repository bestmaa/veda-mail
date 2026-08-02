import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const localInputValue = (hoursAhead: number): string => {
  const date = new Date(Date.now() + hoursAhead * 60 * 60 * 1_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

test("schedules, lists, reschedules, and cancels a provider-backed draft", async ({ page }) => {
  await page.getByRole("button", { name: "New message" }).click();
  const composer = page.getByRole("dialog", { name: "Compose message" });
  await composer.getByRole("textbox", { exact: true, name: "To" })
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

  await page.getByRole("button", { name: "Scheduled", exact: true }).click();
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
