import { expect, test, type Page } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

const openComposer = async (page: Page) => {
  await page.getByRole("button", { name: "New message" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await dialog
    .getByRole("combobox", { exact: true, name: "To" })
    .fill("recipient@example.com");
  return {
    body: dialog.getByRole("textbox", {
      exact: true,
      name: "Message body",
    }),
    dialog,
  };
};

const acceptedResponse = {
  data: {
    deliveryStatus: "accepted",
    id: "pending-accepted",
    rejectedRecipients: [],
    submittedAt: "2026-07-30T00:00:00.000Z",
  },
};

test("nested rich controls consume Escape before the composer", async ({
  page,
}) => {
  const { body, dialog } = await openComposer(page);
  await body.fill("Keep this formatted draft");
  await body.press("Control+A");
  await dialog.getByRole("button", { name: "Insert link" }).click();

  const linkDialog = dialog.getByRole("dialog", { name: "Insert link" });
  const removeLink = linkDialog.getByRole("button", { name: "Remove" });
  await removeLink.focus();
  await removeLink.press("Escape");
  await expect(linkDialog).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(body).toContainText("Keep this formatted draft");
  await expect(body).toBeFocused();

  await body.press("Control+A");
  await dialog.getByRole("button", { name: "Bold" }).click();
  const modeToggle = dialog.getByRole("button", {
    name: "Switch to plain text",
  });
  await modeToggle.click();
  const warning = dialog.getByRole("alertdialog");
  const confirm = warning.getByRole("button", {
    name: "Switch to plain text",
  });
  const keepFormatting = warning.getByRole("button", {
    name: "Keep formatting",
  });
  await expect(confirm).toBeFocused();
  await keepFormatting.focus();
  await keepFormatting.press("Escape");
  await expect(warning).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(modeToggle).toBeFocused();
  await expect(body.locator("strong")).toContainText(
    "Keep this formatted draft",
  );

  await modeToggle.press("Escape");
  const closeWarning = dialog.getByRole("alertdialog", {
    name: "Close with unsaved changes?",
  });
  await expect(closeWarning).toBeVisible();
  await closeWarning
    .getByRole("button", { name: "Close without saving" })
    .click();
  await expect(dialog).toBeHidden();
});

test("pending send locks stale link mutations", async ({ page }) => {
  const gate = { release: (): void => undefined };
  let submitted: Record<string, unknown> | null = null;
  const sendGate = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  await page.route("**/api/v1/mail/send", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await sendGate;
    await route.fulfill({
      body: JSON.stringify(acceptedResponse),
      contentType: "application/json",
      status: 201,
    });
  });

  const { body, dialog } = await openComposer(page);
  await body.fill("Linked draft");
  await body.press("Control+A");
  await dialog.getByRole("button", { name: "Insert link" }).click();
  let linkDialog = dialog.getByRole("dialog", { name: "Insert link" });
  await linkDialog
    .getByRole("textbox", { name: "Link address" })
    .fill("https://example.com/original");
  await linkDialog.getByRole("button", { name: "Apply" }).click();

  await body.press("Control+A");
  await dialog.getByRole("button", { name: "Insert link" }).click();
  linkDialog = dialog.getByRole("dialog", { name: "Insert link" });
  const linkInput = linkDialog.getByRole("textbox", { name: "Link address" });
  await linkInput.fill("https://example.com/stale");
  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await expect(dialog.getByRole("button", { name: "Sending…" })).toBeVisible();
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog).toBeFocused();
  await expect(linkInput).toBeDisabled();
  await expect(linkDialog.getByRole("button", { name: "Apply" })).toBeDisabled();
  await expect(linkDialog.getByRole("button", { name: "Remove" })).toBeDisabled();

  await linkInput.evaluate((element) => {
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "https://attacker.invalid",
        inputType: "insertText",
      }),
    );
  });
  await linkInput.dispatchEvent("keydown", { key: "Enter" });
  await linkDialog
    .getByRole("button", { name: "Apply" })
    .dispatchEvent("click");
  await linkDialog
    .getByRole("button", { name: "Remove" })
    .dispatchEvent("click");
  await expect(
    body.locator('a[href="https://example.com/original"]'),
  ).toContainText("Linked draft");
  expect(submitted).toMatchObject({
    htmlBody: expect.stringContaining("https://example.com/original"),
  });
  expect(JSON.stringify(submitted)).not.toContain("https://example.com/stale");

  gate.release();
  await expect(dialog).toBeHidden();
});

test("pending send disables formatting-loss choices", async ({ page }) => {
  const gate = { release: (): void => undefined };
  const sendGate = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  await page.route("**/api/v1/mail/send", async (route) => {
    await sendGate;
    await route.fulfill({
      body: JSON.stringify(acceptedResponse),
      contentType: "application/json",
      status: 201,
    });
  });

  const { body, dialog } = await openComposer(page);
  await body.fill("Formatted pending draft");
  await body.press("Control+A");
  await dialog.getByRole("button", { name: "Bold" }).click();
  await dialog
    .getByRole("button", { name: "Switch to plain text" })
    .click();
  const warning = dialog.getByRole("alertdialog");
  const confirm = warning.getByRole("button", {
    name: "Switch to plain text",
  });
  const keepFormatting = warning.getByRole("button", {
    name: "Keep formatting",
  });

  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await expect(dialog.getByRole("button", { name: "Sending…" })).toBeVisible();
  await expect(confirm).toBeDisabled();
  await expect(keepFormatting).toBeDisabled();
  await warning.dispatchEvent("keydown", { key: "Escape" });
  await expect(warning).toBeVisible();
  await expect(body.locator("strong")).toContainText("Formatted pending draft");

  gate.release();
  await expect(dialog).toBeHidden();
});
