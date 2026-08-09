import { expect, type Page } from "@playwright/test";

import { expectNoSeriousAccessibilityViolations } from "./mail-fixture";

export const verifyPartialDeliveryNotice = async ({
  page,
}: {
  readonly page: Page;
}) => {
  await page.setViewportSize({ height: 620, width: 1_280 });
  const rejectedRecipients = Array.from(
    { length: 99 },
    (_, index) => `rejected-${index}@example.com`,
  );
  let sendCount = 0;
  await page.route("**/api/v1/mail/send", async (route) => {
    sendCount += 1;
    await route.fulfill({
      body: JSON.stringify({
        data: {
          deliveryNoticeId: "00000000-0000-4000-8000-000000000011",
          deliveryStatus: "partial",
          id: "partially-delivered-message",
          rejectedRecipients,
          submittedAt: "2026-07-30T12:00:00.000Z",
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });

  const composeTrigger = page.getByRole("button", { name: "New message" });
  await composeTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await dialog
    .getByRole("combobox", { exact: true, name: "To" })
    .fill(["accepted@example.com", ...rejectedRecipients].join(", "));
  await dialog
    .getByRole("textbox", { exact: true, name: "Subject" })
    .fill("Partial delivery");
  await dialog
    .getByRole("textbox", { exact: true, name: "Message body" })
    .fill("Send once.");
  await dialog.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("local attachment state"),
    mimeType: "text/plain",
    name: "partial.txt",
  });
  await expect(
    dialog.getByText("partial.txt is ready to send.", { exact: true }),
  ).toBeAttached({ timeout: 20_000 });

  const refresh = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      request.url().includes("/api/v1/mail/workspace"),
  );
  const send = dialog.getByRole("button", { name: /^Send$/ });
  const saveDraft = dialog.getByRole("button", { name: "Save draft" });
  await expect.poll(async () =>
    await send.isEnabled() || await saveDraft.isEnabled(),
  ).toBe(true);
  if (!await send.isEnabled()) await saveDraft.click();
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();
  await expect(dialog).toBeHidden();
  await expect(composeTrigger).toBeFocused();
  await refresh;
  expect(sendCount).toBe(1);

  const warning = page.locator(
    'aside[aria-label="Partial delivery warning"]',
  );
  const status = warning.getByRole("status");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText(
    "Send a new message only to these addresses:",
  );
  await expect(status).toContainText("rejected-0@example.com");
  await expect(status).toContainText("rejected-98@example.com");
  await expect(status).not.toContainText("accepted@example.com");
  await expectNoSeriousAccessibilityViolations(page);

  await composeTrigger.click();
  const inlineWarning = dialog.locator(
    'aside[aria-label="Partial delivery warning"]',
  );
  await expect(inlineWarning).toBeVisible();
  await expect(
    page.locator('aside[aria-label="Partial delivery warning"]'),
  ).toHaveCount(1);
  for (const control of [
    dialog.getByRole("combobox", { exact: true, name: "To" }),
    dialog.getByRole("textbox", { exact: true, name: "Message body" }),
    dialog.getByRole("button", { name: /^Send$/ }),
    dialog.getByRole("button", { name: "Discard draft" }),
  ]) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
  }
  const rejectedList = inlineWarning.getByRole("list", {
    name: "Rejected recipients. Use arrow keys to scroll.",
  });
  await dialog.getByRole("button", { name: "Close composer" }).focus();
  await page.keyboard.press("Tab");
  await expect(rejectedList).toBeFocused();
  expect(
    await rejectedList.evaluate((list) => list.scrollHeight),
  ).toBeGreaterThan(
    await rejectedList.evaluate((list) => list.clientHeight),
  );
  await rejectedList.press("End");
  await expect
    .poll(() => rejectedList.evaluate((list) => list.scrollTop))
    .toBeGreaterThan(0);
  await expect(
    dialog.getByText("partial.txt", { exact: true }),
  ).toBeHidden();
  await dialog.getByRole("button", { name: "Discard draft" }).click();
  await page
    .getByRole("button", { name: "Dismiss delivery warning" })
    .click();
  await expect(status).toBeHidden();
};

export const verifyAllRejectedDraft = async ({
  page,
}: {
  readonly page: Page;
}) => {
  await page.route("**/api/v1/mail/send", (route) =>
    route.fulfill({
      body: JSON.stringify({
        error: {
          code: "MAIL_RECIPIENTS_REJECTED",
          message:
            "The mail provider rejected every recipient. Check the addresses and try again.",
        },
      }),
      contentType: "application/json",
      status: 422,
    }),
  );
  await page.getByRole("button", { name: "New message" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  const to = dialog.getByRole("combobox", { exact: true, name: "To" });
  const body = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  await to.fill("rejected@example.com");
  await body.fill("Keep this body after a complete recipient rejection.");
  await dialog.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("ready attachment"),
    mimeType: "text/plain",
    name: "all-rejected.txt",
  });
  await expect(
    dialog.getByText("all-rejected.txt is ready to send.", { exact: true }),
  ).toBeAttached();

  const response = page.waitForResponse("**/api/v1/mail/send");
  await dialog.getByRole("button", { name: /^Send$/ }).click();
  expect((await response).status()).toBe(422);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(
    "The mail provider rejected every recipient.",
  );
  await expect(to).toHaveValue("rejected@example.com");
  await expect(body).toHaveText(
    "Keep this body after a complete recipient rejection.",
  );
  await expect(
    dialog.getByText("all-rejected.txt", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Send$/ })).toBeEnabled();
};
