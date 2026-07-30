import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
} from "./support/mail-fixture";
import {
  openSignatureSettings,
  signatureEndpoint,
  testSignaturePrefix,
  useIsolatedSignatureMailbox,
} from "./support/signature-fixture";

useIsolatedSignatureMailbox();

test("creates a named rich signature and persists explicit defaults accessibly", async ({
  page,
}) => {
  const signatureName = `${testSignaturePrefix} · settings`;
  const signatureText = "Regards from the E2E settings flow";
  let dialog = await openSignatureSettings(page);

  await expect(dialog.getByText("No signatures yet")).toBeVisible();
  await dialog.getByRole("button", { name: "Create signature" }).click();
  await dialog
    .getByRole("textbox", { name: "Signature name" })
    .fill(signatureName);
  await dialog.getByRole("button", { name: "Rich text" }).click();
  const richEditor = dialog.getByRole("textbox", {
    name: "Signature content",
  });
  await richEditor.fill(signatureText);
  await richEditor.press("Control+A");
  await dialog.getByRole("button", { name: "Bold" }).click();

  let newDefault = dialog.getByLabel("For new messages");
  let replyDefault = dialog.getByLabel("For replies and forwards");
  await expect(newDefault.locator("option:checked")).toHaveText("No signature");
  await expect(replyDefault.locator("option:checked")).toHaveText(
    "No signature",
  );

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(signatureEndpoint) &&
      response.request().method() === "PUT" &&
      response.request().postDataJSON()?.operation === "create",
  );
  const saveSignature = dialog.getByRole("button", {
    name: "Save signature",
  });
  await expect(saveSignature).toBeEnabled();
  await saveSignature.click();
  expect((await createResponse).status()).toBe(201);
  await expect(
    dialog.getByRole("button", { exact: true, name: signatureName }),
  ).toBeVisible();

  await newDefault.selectOption({ label: signatureName });
  await replyDefault.selectOption({ label: signatureName });
  const defaultsResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(signatureEndpoint) &&
      response.request().method() === "PUT" &&
      response.request().postDataJSON()?.operation === "set-defaults",
  );
  await dialog.getByRole("button", { name: "Save defaults" }).click();
  expect((await defaultsResponse).ok()).toBe(true);

  await dialog.locator("[data-settings-initial-focus]").click();
  await expect(dialog).toBeHidden();
  dialog = await openSignatureSettings(page);
  newDefault = dialog.getByLabel("For new messages");
  replyDefault = dialog.getByLabel("For replies and forwards");
  await expect(
    dialog.getByRole("textbox", { name: "Signature name" }),
  ).toHaveValue(signatureName);
  await expect(
    dialog.getByRole("textbox", { name: "Signature content" }),
  ).toContainText(signatureText);
  await expect(newDefault.locator("option:checked")).toHaveText(signatureName);
  await expect(replyDefault.locator("option:checked")).toHaveText(signatureName);

  await expectNoSeriousAccessibilityViolations(page);
  await page.setViewportSize({ height: 600, width: 390 });
  const panel = dialog.locator("section").first();
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  await dialog
    .getByRole("heading", { name: "Signature defaults" })
    .scrollIntoViewIfNeeded();
  await expect(
    dialog.getByRole("button", { name: "Save defaults" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("guards dirty signature changes when account settings closes", async ({
  page,
}) => {
  let dialog = await openSignatureSettings(page);
  await dialog.getByRole("button", { name: "Create signature" }).click();
  const nameInput = dialog.getByRole("textbox", { name: "Signature name" });
  await nameInput.fill(`${testSignaturePrefix} · unsaved`);
  await dialog.locator("[data-settings-initial-focus]").click();

  const confirmation = page.getByRole("alertdialog", {
    name: "Discard signature changes?",
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(nameInput).toHaveValue(`${testSignaturePrefix} · unsaved`);

  await dialog.locator("[data-settings-initial-focus]").click();
  await confirmation
    .getByRole("button", { name: "Discard and close" })
    .click();
  await expect(dialog).toBeHidden();
  dialog = await openSignatureSettings(page);
  await expect(dialog.getByText("No signatures yet")).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Signature name" }),
  ).toHaveCount(0);
});
