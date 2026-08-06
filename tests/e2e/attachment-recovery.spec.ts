import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("retries a transient attachment capability probe without reloading", async ({
  page,
}) => {
  let probes = 0;
  await page.route(
    "**/api/v1/mail/attachments/capability",
    async (requestRoute) => {
      probes += 1;
      const available = probes > 1;
      await requestRoute.fulfill({
        body: JSON.stringify({
          data: {
            maxAttachmentBytes: available ? 18 * 1024 * 1024 : null,
            status: available ? "available" : "unavailable",
          },
        }),
        contentType: "application/json",
        status: 200,
      });
    },
  );

  await page.getByRole("button", { name: "New message" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  const retry = dialog.getByRole("button", {
    name: "Retry attachment check",
  });
  await expect(retry).toBeVisible();
  await retry.click();

  await expect(retry).toBeHidden();
  await expect(dialog.locator('input[type="file"]')).toBeEnabled();
  expect(probes).toBe(2);
});

test("marks a server-invalidated attachment as needing reattachment", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.getByRole("button", { name: "New message" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await dialog
    .getByRole("combobox", { exact: true, name: "To" })
    .fill("recipient@example.com");
  await dialog
    .getByRole("textbox", { exact: true, name: "Message body" })
    .fill("Expired attachment recovery.");
  const uploaded = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" &&
    candidate.url().endsWith("/api/v1/mail/attachments"));
  await dialog.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("temporary attachment"),
    mimeType: "text/plain",
    name: "expired.txt",
  });
  expect((await uploaded).ok()).toBe(true);
  await expect(dialog.getByText("expired.txt", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/text\/plain/)).toBeVisible();

  await page.route("**/api/v1/mail/send", async (requestRoute) => {
    await requestRoute.fulfill({
      body: JSON.stringify({
        error: {
          code: "ATTACHMENT_EXPIRED",
          message: "Attachment reservation expired.",
        },
      }),
      contentType: "application/json",
      status: 410,
    });
  });
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      candidate.url().endsWith("/api/v1/mail/send"),
  );
  await dialog.getByRole("button", { name: /^Send$/ }).click();
  expect((await response).status()).toBe(410);

  await expect(
    dialog
      .getByRole("list", { name: "Message attachments" })
      .getByText(
        "An attachment is no longer available. Remove it and attach the file again.",
        { exact: true },
      ),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Send$/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "Remove expired.txt" }).click();
});
