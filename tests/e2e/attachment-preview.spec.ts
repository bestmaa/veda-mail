import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  mailSessionScopeHeaders,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const previewPath =
  "/api/v1/mail/messages/msg-preview-security-fixture/attachments/attachment-preview-plain-text/preview";

test("scans and renders plain text in a sandbox without active content", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  let leakedRequests = 0;
  let popups = 0;
  page.on("request", (request) => {
    if (request.url().includes("preview-leak.invalid")) leakedRequests += 1;
  });
  page.on("popup", () => {
    popups += 1;
  });
  await page
    .getByRole("button", { name: "Open Attachment preview security fixture" })
    .click();
  const previewButton = page.getByRole("button", {
    name: "Preview security-notes.txt",
  });
  await expect(previewButton).toBeVisible();
  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith(previewPath) && request.method() === "POST",
  );

  await previewButton.focus();
  await page.keyboard.press("Enter");

  const previewRequest = await requestPromise;
  expect(previewRequest.postDataJSON()).toEqual({ renderer: "text" });
  const dialog = page.getByRole("dialog", {
    name: "Preview: security-notes.txt",
  });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", {
    name: "Close attachment preview",
  });
  await expect(close).toBeFocused();
  const frame = dialog.locator("iframe");
  await expect(frame).toHaveAttribute("sandbox", "allow-same-origin");
  await expect(frame).not.toHaveAttribute("sandbox", /allow-scripts/u);
  await expect(frame).not.toHaveAttribute("allow", /.+/u);
  await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  await previewButton.evaluate((element) => element.focus());
  await expect(close).toBeFocused();
  const frameBody = page
    .frameLocator('iframe[title="Plain text attachment preview"]')
    .locator("body");
  await expect(frameBody).toContainText(
    '<img src="https://preview-leak.invalid/pixel">',
  );
  for (const key of ["Tab", "Shift+Tab", "Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(
      await page.evaluate(() =>
        Boolean(
          document.querySelector("dialog")?.contains(document.activeElement),
        ),
      ),
    ).toBe(true);
  }
  await frameBody.click();
  await expect(frame).toBeFocused();
  expect(leakedRequests).toBe(0);
  expect(popups).toBe(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);
  const blobUrl = await frame.getAttribute("src");
  expect(blobUrl).toMatch(/^blob:/u);

  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
  await expect(previewButton).toBeFocused();
  const revoked = await page.evaluate(async (url) => {
    if (!url) return false;
    try {
      await fetch(url);
      return false;
    } catch {
      return true;
    }
  }, blobUrl);
  expect(revoked).toBe(true);
});

test("keeps preview POST-only, authenticated, same-origin, and range-free", async ({
  page,
  request,
}) => {
  const origin = new URL(page.url()).origin;
  const body = { renderer: "text" };
  const scopeHeaders = await mailSessionScopeHeaders(page);

  const unauthenticated = await request.post(previewPath, {
    data: body,
    headers: { origin },
  });
  expect(unauthenticated.status()).toBe(401);

  const crossOrigin = await page.request.post(previewPath, {
    data: body,
    headers: { origin: "https://evil.example" },
  });
  expect(crossOrigin.status()).toBe(403);

  const ranged = await page.request.post(previewPath, {
    data: body,
    headers: { origin, range: "bytes=0-10", ...scopeHeaders },
  });
  expect(ranged.status()).toBe(416);

  expect((await page.request.get(previewPath)).status()).toBe(405);
  expect((await page.request.head(previewPath)).status()).toBe(405);
  expect(
    (
      await page.request.post(`${previewPath}?renderer=text`, {
        data: body,
        headers: { origin, ...scopeHeaders },
      })
    ).status(),
  ).toBe(400);
});

test("does not offer raw preview for PDF attachments", async ({ page }) => {
  await page
    .getByRole("button", { name: "Open Revised product roadmap" })
    .click();

  await expect(
    page.getByRole("button", { name: "Preview Q3-roadmap.pdf" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download Q3-roadmap.pdf" }),
  ).toBeVisible();
});

test("shows a safe actionable failure without replacing Download", async ({
  page,
}) => {
  await page.route(`**${previewPath}`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "ATTACHMENT_PREVIEW_BLOCKED",
          message: "This attachment was blocked from preview.",
        },
      }),
      contentType: "application/json",
      status: 422,
    });
  });
  await page
    .getByRole("button", { name: "Open Attachment preview security fixture" })
    .click();

  await page
    .getByRole("button", { name: "Preview security-notes.txt" })
    .click();

  await expect(
    page.getByRole("alert").filter({
      hasText: "This attachment was blocked from preview.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download security-notes.txt" }),
  ).toBeVisible();
});
