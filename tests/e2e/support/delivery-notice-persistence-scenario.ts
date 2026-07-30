import { expect, type Page } from "@playwright/test";

const noticeId = "00000000-0000-4000-8000-000000000021";
const submittedAt = "2026-07-30T12:00:00.000Z";
const recipient = "persisted-retry-unique@example.com";

export const verifyDeliveryNoticePersistence = async ({
  page,
}: {
  readonly page: Page;
}) => {
  await page.route("**/api/v1/mail/delivery-notices", (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          notices: [
            {
              deliveryNoticeId: noticeId,
              kind: "partial",
              rejectedRecipients: [recipient],
              submittedAt,
            },
          ],
        },
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  let releaseDelete: () => void = () => undefined;
  const pendingDelete = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let deleteCount = 0;
  await page.route("**/api/v1/mail/delivery-notices/*", async (route) => {
    deleteCount += 1;
    if (deleteCount === 1) {
      await pendingDelete;
      await route.fulfill({
        body: JSON.stringify({
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message: "Persistence is temporarily unavailable.",
          },
        }),
        contentType: "application/json",
        status: 503,
      });
      return;
    }
    await route.fulfill({ body: "", status: 204 });
  });
  await page.reload();

  const warning = page.locator(
    'aside[aria-label="Partial delivery warning"]',
  );
  await expect(warning).toContainText(recipient);
  const browserStorage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(browserStorage).not.toContain(recipient);

  await page.route("**/api/v1/mail/send", (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          deliveryNoticeId: noticeId,
          deliveryStatus: "partial",
          id: "same-persisted-notice",
          rejectedRecipients: [recipient],
          submittedAt,
        },
      }),
      contentType: "application/json",
      status: 201,
    }),
  );
  await page.getByRole("button", { name: "New message" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await dialog
    .getByRole("textbox", { exact: true, name: "To" })
    .fill(`accepted@example.com, ${recipient}`);
  await dialog
    .getByRole("textbox", { exact: true, name: "Message body" })
    .fill("Do not duplicate the hydrated warning.");
  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await expect(dialog).toBeHidden();
  await expect(warning).toBeVisible();
  await expect(warning).not.toContainText("2 delivery notices");

  const firstDelete = page.waitForRequest(
    (request) =>
      request.method() === "DELETE" &&
      request.url().endsWith(`/delivery-notices/${noticeId}`),
  );
  await warning
    .getByRole("button", { name: "Dismiss delivery warning" })
    .click();
  await firstDelete;
  await expect(warning).toBeHidden();
  releaseDelete();
  await expect(warning).toBeVisible();
  await expect(warning.getByRole("alert")).toHaveText(
    "This delivery notice could not be dismissed. Try again.",
  );

  const successfulDelete = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith(`/delivery-notices/${noticeId}`),
  );
  await warning
    .getByRole("button", { name: "Dismiss delivery warning" })
    .click();
  expect((await successfulDelete).status()).toBe(204);
  await expect(warning).toBeHidden();
  expect(deleteCount).toBe(2);

  await page.unroute("**/api/v1/mail/delivery-notices");
  let releaseHydration: () => void = () => undefined;
  const pendingHydration = new Promise<void>((resolve) => {
    releaseHydration = resolve;
  });
  await page.route("**/api/v1/mail/delivery-notices", async (route) => {
    await pendingHydration;
    await route
      .fulfill({
        body: JSON.stringify({
          data: {
            notices: [
              {
                deliveryNoticeId:
                  "00000000-0000-4000-8000-000000000099",
                kind: "partial",
                rejectedRecipients: ["old-account-secret@example.com"],
                submittedAt,
              },
            ],
          },
        }),
        contentType: "application/json",
        status: 200,
      })
      .catch(() => undefined);
  });
  const hydrationRequest = page.waitForRequest(
    "**/api/v1/mail/delivery-notices",
  );
  await page.reload();
  await hydrationRequest;
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email address")).toBeVisible();
  releaseHydration();
  await expect(
    page.getByText("old-account-secret@example.com"),
  ).toHaveCount(0);
};
