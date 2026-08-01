import { expect, test } from "@playwright/test";
import type { Response } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const labelResponse = (method: "PATCH" | "POST") => (response: Response) =>
  response.url().endsWith("/api/v1/mail/labels") &&
  response.request().method() === method;
const messageMutation = (response: Response) =>
  /\/api\/v1\/mail\/messages\/(?:bulk|[^/]+)$/u.test(new URL(response.url()).pathname) &&
  response.request().method() === "PATCH";

test("creates, edits, applies, and removes a portable label", async ({ page }) => {
  const initialName = `E2E label ${Date.now()}`;
  const editedName = `${initialName} edited`;

  await page.getByRole("button", { name: "Create label" }).click();
  let dialog = page.getByRole("dialog", { name: "Create label" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(initialName);
  await dialog.getByRole("radio", { name: "Use #4f46e5" }).check();
  const create = page.waitForResponse(labelResponse("POST"));
  await dialog.getByRole("button", { name: "Create" }).click();
  expect((await create).status()).toBe(201);
  await expect(page.getByRole("button", {
    name: `Manage ${initialName} label`,
  })).toBeVisible();

  await page.getByRole("button", {
    name: `Manage ${initialName} label`,
  }).click();
  dialog = page.getByRole("dialog", { name: "Edit label" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(editedName);
  await dialog.getByRole("radio", { name: "Use #10b981" }).check();
  await expectNoSeriousAccessibilityViolations(page);
  const update = page.waitForResponse(labelResponse("PATCH"));
  await dialog.getByRole("button", { name: "Save" }).click();
  expect((await update).ok()).toBe(true);
  await expect(page.getByRole("button", {
    name: `Manage ${editedName} label`,
  })).toBeVisible();

  const selectMessage = page.getByRole("checkbox", {
    name: "Select Your Stalwart workspace is ready",
  });
  await selectMessage.check();
  let mutate = page.waitForResponse(messageMutation);
  await page.getByLabel("Apply label…").selectOption({ label: editedName });
  expect((await mutate).ok()).toBe(true);
  await expect(page.getByLabel("Message labels").last().getByText(editedName)).toBeVisible();

  await selectMessage.check();
  mutate = page.waitForResponse(messageMutation);
  await page.getByLabel("Remove label…").selectOption({ label: editedName });
  expect((await mutate).ok()).toBe(true);
  await expect(page.getByLabel("Message labels").getByText(editedName)).toHaveCount(0);

  await page.getByRole("button", {
    name: "Open Your Stalwart workspace is ready",
  }).click();
  mutate = page.waitForResponse(messageMutation);
  await page.getByLabel("Apply label to message").selectOption({ label: editedName });
  expect((await mutate).ok()).toBe(true);
  await expect(page.getByLabel("Message labels").last().getByText(editedName)).toBeVisible();
  mutate = page.waitForResponse(messageMutation);
  await page.getByLabel("Remove label from message").selectOption({ label: editedName });
  expect((await mutate).ok()).toBe(true);
  await expect(page.getByLabel("Message labels").getByText(editedName)).toHaveCount(0);
});
