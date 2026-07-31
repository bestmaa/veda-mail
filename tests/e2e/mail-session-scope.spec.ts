import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("fails closed when another tab replaces the mailbox session", async ({
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
          code: "MAIL_SESSION_CHANGED",
          message: "Mailbox session changed. Reload this page and try again.",
        },
      }),
      contentType: "application/json",
      status: 409,
    });
  });

  await page.reload();

  await expect(
    page.getByText("Mailbox session changed. Reload this page and try again."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New message" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Compose message" }),
  ).toBeDisabled();
});

test("fails closed when signature loading loses authentication", async ({
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
          code: "MEMBER_SESSION_EXPIRED",
          message: "Reconnect this mailbox.",
        },
      }),
      contentType: "application/json",
      status: 401,
    });
  });

  await page.reload();

  await expect(page.getByText("Reconnect this mailbox.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New message" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Compose message" }),
  ).toBeDisabled();
});

test("never bootstraps another account after a scoped workspace failure", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: "New message" }),
  ).toBeEnabled();

  await page.route("**/api/v1/mail/workspace*", async (route) => {
    if (!route.request().headers()["x-veda-mail-session-scope"]) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "MAIL_SESSION_CHANGED",
          message: "Mailbox session changed. Reload this page and try again.",
        },
      }),
      contentType: "application/json",
      status: 409,
    });
  });
  const unscopedReload = page
    .waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/v1/mail/workspace" &&
        !request.headers()["x-veda-mail-session-scope"],
      { timeout: 1_000 },
    )
    .then(
      () => true,
      () => false,
    );

  await page.getByRole("button", { name: "Refresh mail" }).click();

  await expect(
    page.getByText("Mailbox session changed. Reload this page and try again."),
  ).toBeVisible();
  expect(await unscopedReload).toBe(false);
  await expect(
    page.getByRole("button", { name: "New message" }),
  ).toBeDisabled();
});
