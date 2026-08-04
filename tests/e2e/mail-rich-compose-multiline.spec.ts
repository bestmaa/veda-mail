import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("preserves multiline plain paste in a formatted rich send", async ({
  page,
}) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/mail/send", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      body: JSON.stringify({
        data: {
          deliveryStatus: "accepted",
          id: "multiline-accepted",
          rejectedRecipients: [],
          submittedAt: "2026-07-30T00:00:00.000Z",
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.getByRole("button", { name: "New message" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await dialog
    .getByRole("combobox", { exact: true, name: "To" })
    .fill("recipient@example.com");
  const body = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  await body.focus();
  await body.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "Line one\r\nLine two");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  });
  await expect(body.locator("br")).toHaveCount(1);
  await body.press("Control+A");
  await dialog.getByRole("button", { name: "Bold" }).click();
  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await expect(dialog).toBeHidden();

  expect(submitted).toMatchObject({ body: "Line one\nLine two" });
  expect(String(submitted?.["htmlBody"])).toMatch(/<br\s*\/?>/u);
});

test("rejects oversized multiline rich paste and drop without truncating", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New message" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  const body = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  const oversized = `first${"\n".repeat(1_000)}last`;

  await body.evaluate((element, text) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  }, oversized);
  await expect(body).toBeEmpty();
  await expect(
    dialog.getByText(/too many lines.*plain text mode/iu),
  ).toHaveText(/paste or drop it again/iu);

  await body.evaluate((element, text) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", text);
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, oversized);
  await expect(body).toBeEmpty();
  await expect(
    dialog.getByText(/too many lines.*plain text mode/iu),
  ).toHaveText(/paste or drop it again/iu);
});
