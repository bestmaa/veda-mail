import { expect, test } from "@playwright/test";

import { expectNoSeriousAccessibilityViolations } from "./support/mail-fixture";
import {
  templateEndpoint,
  testTemplatePrefix,
  useIsolatedTemplateMailbox,
} from "./support/template-fixture";

useIsolatedTemplateMailbox();

test("creates, persists, inserts, replaces, updates, and deletes a template", async ({ page }) => {
  const templateName = `${testTemplatePrefix} - interview`;
  await page.getByRole("button", { name: "New message" }).click();
  const composer = page.getByRole("dialog", { name: "Compose message" });
  const to = composer.getByRole("combobox", { exact: true, name: "To" });
  const subject = composer.getByRole("textbox", { exact: true, name: "Subject" });
  const body = composer.getByRole("textbox", { exact: true, name: "Message body" });
  await to.fill("recipient@example.com");
  await subject.fill("Reusable subject");
  await body.fill("Reusable body");

  await composer.getByRole("button", { name: "Save current as new" }).click();
  let saveDialog = page.getByRole("dialog", { name: "Save email template" });
  await saveDialog.getByLabel("Template name").fill(templateName);
  const createResponse = page.waitForResponse((response) =>
    response.url().endsWith(templateEndpoint) &&
    response.request().method() === "PUT" &&
    response.request().postDataJSON()?.operation === "create",
  );
  await saveDialog.getByRole("button", { name: "Save template" }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(saveDialog).toBeHidden();
  const picker = composer.getByRole("combobox", { name: "Email template" });
  await expect(picker.locator("option:checked")).toHaveText(templateName);

  await subject.fill("Current subject");
  await body.fill("Current body");
  await body.press("End");
  await composer.getByRole("button", { exact: true, name: "Insert" }).click();
  await expect(body).toContainText("Current body");
  await expect(body).toContainText("Reusable body");
  await expect(subject).toHaveValue("Current subject");
  await expect(to).toHaveValue("recipient@example.com");

  await composer.getByRole("button", { exact: true, name: "Replace" }).click();
  let replaceDialog = page.getByRole("alertdialog", {
    name: "Replace current message?",
  });
  await expect(replaceDialog).toContainText("Recipients, attachments, reply context");
  await replaceDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(subject).toHaveValue("Current subject");
  await expect(body).toContainText("Current body");

  await composer.getByRole("button", { exact: true, name: "Replace" }).click();
  replaceDialog = page.getByRole("alertdialog", { name: "Replace current message?" });
  await replaceDialog.getByRole("button", { name: "Replace message" }).click();
  await expect(subject).toHaveValue("Reusable subject");
  await expect(body).toHaveText("Reusable body");
  await expect(to).toHaveValue("recipient@example.com");
  await expectNoSeriousAccessibilityViolations(page);

  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/mail/send", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      body: JSON.stringify({ data: {
        deliveryStatus: "accepted",
        id: "template-send",
        rejectedRecipients: [],
        submittedAt: "2026-08-02T00:00:00.000Z",
      } }),
      contentType: "application/json",
      status: 201,
    });
  });
  await composer.getByRole("button", { name: /^Send$/ }).click();
  await expect(composer).toBeHidden();
  expect(submitted).toMatchObject({
    body: "Reusable body",
    subject: "Reusable subject",
    to: [{ email: "recipient@example.com", name: null }],
  });

  await page.reload();
  await page.getByRole("button", { name: "New message" }).click();
  await expect(picker.locator("option:checked")).toHaveText(templateName);
  await body.fill("Updated reusable body");
  await subject.fill("Updated reusable subject");
  await composer.getByRole("button", { name: "Update selected" }).click();
  saveDialog = page.getByRole("dialog", { name: "Save email template" });
  const updateResponse = page.waitForResponse((response) =>
    response.url().endsWith(templateEndpoint) &&
    response.request().postDataJSON()?.operation === "update",
  );
  await saveDialog.getByRole("button", { name: "Save template" }).click();
  expect((await updateResponse).ok()).toBe(true);
  await composer.getByRole("button", { name: "Delete selected" }).click();
  const deleteDialog = page.getByRole("alertdialog", { name: "Delete email template?" });
  const deleteResponse = page.waitForResponse((response) =>
    response.url().endsWith(templateEndpoint) &&
    response.request().postDataJSON()?.operation === "delete",
  );
  await deleteDialog.getByRole("button", { name: "Delete template" }).click();
  expect((await deleteResponse).ok()).toBe(true);
  await expect(picker).toContainText("No saved templates");
});

test("keeps compose usable when template loading fails", async ({ page }) => {
  await page.route("**/api/v1/member/templates", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      body: JSON.stringify({ error: {
        code: "TEMPLATE_STORE_UNAVAILABLE",
        message: "Email templates are temporarily unavailable.",
      } }),
      contentType: "application/json",
      status: 503,
    });
  });
  await page.reload();
  const compose = page.getByRole("button", { name: "New message" });
  await expect(compose).toBeEnabled();
  await compose.click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await expect(dialog.getByText("Email templates are temporarily unavailable.")).toBeVisible();
  const body = dialog.getByRole("textbox", { exact: true, name: "Message body" });
  await body.fill("Basic compose remains available");
  await expect(body).toContainText("Basic compose remains available");
});
