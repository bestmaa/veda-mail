import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousAccessibilityViolations } from "./support/mail-fixture";
import {
  createRichSignature,
  removeTestSignatures,
  reloadMailbox,
  saveSignatureDefaults,
  signatureAttribute,
  testSignaturePrefix,
} from "./support/signature-fixture";
import {
  createTemplate,
  templateEndpoint,
  testTemplatePrefix,
  useIsolatedTemplateMailbox,
} from "./support/template-fixture";

useIsolatedTemplateMailbox();
test.afterEach(async ({ page }) => {
  if (!page.isClosed()) await removeTestSignatures(page);
});

const gateTemplateMutation = async (
  page: Page,
  operation: "create" | "delete",
) => {
  let release = () => {};
  let markStarted = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  await page.route(`**${templateEndpoint}`, async (route) => {
    if (route.request().postDataJSON()?.operation === operation) {
      markStarted();
      await released;
    }
    await route.continue();
  }, { times: 1 });
  return { release, started };
};

test("inserts a plain template over the exact textarea selection", async ({
  page,
}) => {
  const name = `${testTemplatePrefix} - plain selection`;
  await createTemplate(page, name, {
    body: "quick",
    mode: "plain",
    subject: "Template subject",
  });
  await reloadMailbox(page);
  await page.getByRole("button", { name: "New message" }).click();
  const composer = page.getByRole("dialog", { name: "Compose message" });
  await composer.getByRole("button", { name: "Switch to plain text" }).click();
  const body = composer.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  await body.fill("Hello slow world");
  await body.evaluate((node: HTMLTextAreaElement) => {
    node.focus();
    node.setSelectionRange(6, 10);
  });
  await composer.getByRole("button", { exact: true, name: "Insert" }).click();
  await expect(body).toHaveValue("Hello quick world");
});

test("contains focus and Escape while template mutations are pending", async ({
  page,
}) => {
  await createTemplate(page, `${testTemplatePrefix} - focus seed`, {
    body: "Seed body",
    mode: "plain",
    subject: "Seed subject",
  });
  await reloadMailbox(page);
  await page.getByRole("button", { name: "New message" }).click();
  const composer = page.getByRole("dialog", { name: "Compose message" });
  const body = composer.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  await body.fill("Reusable body");
  await composer.getByRole("button", { name: "Save current as new" }).click();
  let saveDialog = page.getByRole("dialog", { name: "Save email template" });
  const nameInput = saveDialog.getByLabel("Template name");
  await expect(nameInput).toBeFocused();
  await expect(composer.locator("[inert]")).toHaveCount(1);
  await expectNoSeriousAccessibilityViolations(page);
  await page.keyboard.press("Escape");
  await expect(saveDialog).toBeHidden();
  await expect(composer.getByRole("combobox", { name: "Email template" }))
    .toBeFocused();

  await composer.getByRole("button", { name: "Save current as new" }).click();
  saveDialog = page.getByRole("dialog", { name: "Save email template" });
  await saveDialog.getByLabel("Template name").fill(
    `${testTemplatePrefix} - pending dialog`,
  );
  const createGate = await gateTemplateMutation(page, "create");
  await saveDialog.getByRole("button", { name: "Save template" }).click();
  await createGate.started;
  await expect(saveDialog.getByLabel("Template name")).toBeDisabled();
  await expect(saveDialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(saveDialog).toBeVisible();
  await expect(composer).toBeVisible();
  createGate.release();
  await expect(saveDialog).toBeHidden();

  await composer.getByRole("button", { name: "Delete selected" }).click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: "Delete email template?",
  });
  const deleteGate = await gateTemplateMutation(page, "delete");
  await deleteDialog.getByRole("button", { name: "Delete template" }).click();
  await deleteGate.started;
  await expect(deleteDialog.getByRole("button", { name: "Cancel" }))
    .toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(deleteDialog).toBeVisible();
  deleteGate.release();
  await expect(deleteDialog).toBeHidden();
});

test("preserves the managed signature in a short mobile composer", async ({
  page,
}) => {
  await page.setViewportSize({ height: 520, width: 390 });
  await removeTestSignatures(page);
  const seeded = await createRichSignature(
    page,
    `${testSignaturePrefix} - template mobile`,
    "Mobile managed signature",
  );
  await saveSignatureDefaults(page, seeded.book, seeded.signature.id, null);
  await createTemplate(page, `${testTemplatePrefix} - signature`, {
    htmlBody: "<p><strong>Template message</strong></p>",
    mode: "rich",
    subject: "Template subject",
  });
  await reloadMailbox(page);
  await page.getByRole("button", {
    exact: true,
    name: "Compose a new message",
  }).click();
  const composer = page.getByRole("dialog", { name: "Compose message" });
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(520);
  const body = composer.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  const signature = body.locator(`[${signatureAttribute}]`);
  await expect(signature).toHaveCount(1);
  await composer.getByRole("textbox", { exact: true, name: "Subject" })
    .fill("Replace this");
  await composer.getByRole("button", { exact: true, name: "Replace" }).click();
  await page.getByRole("alertdialog", { name: "Replace current message?" })
    .getByRole("button", { name: "Replace message" }).click();
  await expect(body).toContainText("Template message");
  await expect(signature).toHaveCount(1);
  await expect(signature).toContainText("Mobile managed signature");
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
});
