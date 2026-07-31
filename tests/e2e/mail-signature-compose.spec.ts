import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
} from "./support/mail-fixture";
import {
  createRichSignature,
  occurrences,
  reloadMailbox,
  saveSignatureDefaults,
  signatureAttribute,
  testSignaturePrefix,
  useIsolatedSignatureMailbox,
} from "./support/signature-fixture";

useIsolatedSignatureMailbox();

test("keeps one new-message signature through picker changes and plain conversion", async ({
  page,
}) => {
  const alphaText = "E2E alpha signature";
  const betaText = "E2E beta signature";
  const alpha = await createRichSignature(
    page,
    `${testSignaturePrefix} · alpha`,
    alphaText,
  );
  const beta = await createRichSignature(
    page,
    `${testSignaturePrefix} · beta`,
    betaText,
  );
  await saveSignatureDefaults(page, beta.book, alpha.signature.id, null);
  let releaseSignatureLoad: () => void = () => {};
  let markSignatureLoadStarted: () => void = () => {};
  const signatureLoadGate = new Promise<void>((resolve) => {
    releaseSignatureLoad = resolve;
  });
  const signatureLoadStarted = new Promise<void>((resolve) => {
    markSignatureLoadStarted = resolve;
  });
  await page.route("**/api/v1/member/signatures", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    markSignatureLoadStarted();
    await signatureLoadGate;
    await route.continue();
  });
  await page.reload();
  await signatureLoadStarted;
  const composeButton = page.getByRole("button", { name: "New message" });
  await expect(composeButton).toBeVisible();
  await expect(composeButton).toBeDisabled();
  releaseSignatureLoad();
  await expect(composeButton).toBeEnabled();

  let submitted: Record<string, unknown> | null = null;
  let submittedSessionScope = "";
  await page.route("**/api/v1/mail/send", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    submittedSessionScope =
      route.request().headers()["x-veda-mail-session-scope"] ?? "";
    await route.fulfill({
      body: JSON.stringify({
        data: {
          deliveryStatus: "accepted",
          id: "signature-accepted",
          rejectedRecipients: [],
          submittedAt: "2026-07-31T00:00:00.000Z",
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });

  await composeButton.click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  let body = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  const picker = dialog.getByRole("combobox", { name: "Email signature" });
  const slot = body.locator(`[${signatureAttribute}]`);

  await expect(picker).toHaveValue(alpha.signature.id);
  await expect(slot).toHaveCount(1);
  await expect(slot).toHaveAttribute(signatureAttribute, alpha.signature.id);
  await expect(slot).toContainText(alphaText);
  expect(occurrences((await body.textContent()) ?? "", alphaText)).toBe(1);

  await picker.selectOption("");
  await expect(slot).toHaveAttribute(signatureAttribute, "");
  await expect(slot).toBeEmpty();
  await picker.selectOption(beta.signature.id);
  await expect(slot).toHaveAttribute(signatureAttribute, beta.signature.id);
  await expect(slot).toContainText(betaText);
  await expect(body).not.toContainText(alphaText);
  await picker.selectOption(alpha.signature.id);
  await expect(slot).toHaveAttribute(signatureAttribute, alpha.signature.id);
  expect(occurrences((await body.textContent()) ?? "", alphaText)).toBe(1);

  await body.click({ position: { x: 8, y: 8 } });
  await body.press("Control+Home");
  await body.pressSequentially("Message before signature");
  await dialog
    .getByRole("button", { name: "Switch to plain text" })
    .click();
  const warning = dialog.getByRole("alertdialog", {
    name: "Remove message formatting?",
  });
  await expect(warning).toBeVisible();
  await warning
    .getByRole("button", { name: "Switch to plain text" })
    .click();

  let plainBody = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  await expect(plainBody).toContainText("Message before signature");
  expect(occurrences(await plainBody.inputValue(), alphaText)).toBe(1);
  await expect(
    dialog.getByText("Signature is now editable message text"),
  ).toBeVisible();
  await expect(picker).toHaveCount(0);

  await dialog
    .getByRole("button", { name: "Switch to rich text" })
    .click();
  body = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  await expect(body.locator(`[${signatureAttribute}]`)).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Switch to plain text" })
    .click();
  plainBody = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  expect(occurrences(await plainBody.inputValue(), alphaText)).toBe(1);

  await dialog
    .getByRole("textbox", { exact: true, name: "To" })
    .fill("recipient@example.com");
  await dialog
    .getByRole("textbox", { exact: true, name: "Subject" })
    .fill("Signature exact-once acceptance");
  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await expect(dialog).toBeHidden();
  expect(submitted).not.toBeNull();
  expect(submittedSessionScope).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(occurrences(String(submitted?.["body"] ?? ""), alphaText)).toBe(1);
  expect(submitted).not.toHaveProperty("htmlBody");
});

test("keeps signature-free compose available when loading fails", async ({
  page,
}) => {
  await page.route("**/api/v1/member/signatures", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "SIGNATURES_UNAVAILABLE",
          message: "Email signatures are temporarily unavailable.",
        },
      }),
      contentType: "application/json",
      status: 503,
    });
  });
  await page.reload();
  const composeButton = page.getByRole("button", { name: "New message" });
  await expect(composeButton).toBeEnabled();
  await composeButton.click();

  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await expect(
    dialog.getByRole("combobox", { name: "Email signature" }),
  ).toHaveCount(0);
  await expect(
    dialog
      .getByRole("textbox", { exact: true, name: "Message body" })
      .locator(`[${signatureAttribute}]`),
  ).toHaveCount(0);
});

test("places the reply-forward default once before quoted content", async ({
  page,
}) => {
  const signatureText = "E2E reply and forward signature";
  const seeded = await createRichSignature(
    page,
    `${testSignaturePrefix} · reply-forward`,
    signatureText,
  );
  await saveSignatureDefaults(page, seeded.book, null, seeded.signature.id);
  await reloadMailbox(page);
  await page
    .getByRole("button", { name: "Open Revised product roadmap · Q3" })
    .click();

  await page.getByRole("button", { name: "Reply all" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  let body = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  let slot = body.locator(`[${signatureAttribute}]`);
  await expect(slot).toHaveCount(1);
  await expect(slot).toHaveAttribute(signatureAttribute, seeded.signature.id);
  const replyText = (await body.innerText()).trim();
  expect(occurrences(replyText, signatureText)).toBe(1);
  expect(replyText.indexOf(signatureText)).toBeLessThan(replyText.indexOf("On "));
  await expect(
    dialog.getByRole("combobox", { name: "Email signature" }),
  ).toHaveValue(seeded.signature.id);
  await expectNoSeriousAccessibilityViolations(page);
  await page.keyboard.press("Escape");
  const closeWarning = dialog.getByRole("alertdialog", {
    name: "Close with unsaved changes?",
  });
  await expect(closeWarning).toBeVisible();
  await closeWarning.getByRole("button", { name: "Close without saving" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Forward" }).click();
  body = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  slot = body.locator(`[${signatureAttribute}]`);
  await expect(slot).toHaveCount(1);
  await expect(slot).toHaveAttribute(signatureAttribute, seeded.signature.id);
  const forwardText = (await body.innerText()).trim();
  expect(occurrences(forwardText, signatureText)).toBe(1);
  expect(forwardText.indexOf(signatureText)).toBeLessThan(
    forwardText.indexOf("---------- Forwarded message ----------"),
  );
});
