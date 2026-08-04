import { expect, test, type Page } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

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

test("formats semantic rich mail with keyboard-accessible controls", async ({
  page,
}) => {
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/v1/mail/send", async (route) => {
    payloads.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      body: JSON.stringify({
        data: {
          deliveryStatus: "accepted",
          id: "rich-accepted",
          rejectedRecipients: [],
          submittedAt: "2026-07-30T00:00:00.000Z",
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  const { body, dialog } = await openComposer(page);
  await dialog
    .getByRole("textbox", { exact: true, name: "Subject" })
    .fill("Rich semantic update");
  await body.fill("Alpha");
  await body.press("End");
  await body.press("Enter");
  await body.pressSequentially("Beta");
  await body.press("Control+A");

  const style = dialog.getByRole("combobox", { name: "Text style" });
  await style.focus();
  await style.press("ArrowRight");
  await expect(dialog.getByRole("button", { name: "Bold" })).toBeFocused();
  await style.selectOption("h1");
  await expect(body.locator("h1")).toHaveCount(2);
  await expect(body.locator("h1").first()).toContainText("Alpha");

  await body.press("Control+A");
  await dialog.getByRole("button", { name: "Undo" }).click();
  await body.press("Control+A");
  await dialog.getByRole("button", { name: "Bulleted list" }).click();
  await expect(body.locator("ul")).toBeVisible();
  await expect(body.locator("li")).toHaveCount(2);

  await body.press("Control+A");
  await dialog.getByRole("button", { name: "Bold" }).click();
  await expect(
    dialog.getByRole("button", { name: "Bold" }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Insert link" }).click();
  const linkDialog = dialog.getByRole("dialog", { name: "Insert link" });
  await linkDialog
    .getByRole("textbox", { name: "Link address" })
    .fill("https://example.com/roadmap");
  await linkDialog.getByRole("button", { name: "Apply" }).click();
  await expect(linkDialog).toBeHidden();
  await expect(
    body.locator('a[href="https://example.com/roadmap"]'),
  ).toHaveCount(2);

  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await expect(dialog).toBeHidden();
  expect(payloads).toHaveLength(1);
  expect(payloads[0]?.["body"]).toMatch(/Alpha[\s\S]*Beta/u);
  expect(String(payloads[0]?.["htmlBody"])).toMatch(/<ul[\s>]/u);
  expect(String(payloads[0]?.["htmlBody"])).toMatch(/<(?:b|strong)[\s>]/u);
  expect(String(payloads[0]?.["htmlBody"])).toContain(
    'href="https://example.com/roadmap"',
  );
});

test("pastes only text, rejects active links, and safely switches to plain", async ({
  page,
}) => {
  let trackerRequests = 0;
  let submitted: Record<string, unknown> | null = null;
  await page.route("https://tracker.invalid/**", async (route) => {
    trackerRequests += 1;
    await route.abort();
  });
  await page.route("**/api/v1/mail/send", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      body: JSON.stringify({
        data: {
          deliveryStatus: "accepted",
          id: "plain-accepted",
          rejectedRecipients: [],
          submittedAt: "2026-07-30T00:00:00.000Z",
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  const { body, dialog } = await openComposer(page);
  await body.focus();
  await body.evaluate((element) => {
    const data = new DataTransfer();
    data.setData(
      "text/html",
      '<img src="https://tracker.invalid/pixel"><b>Visible paste</b>',
    );
    data.setData("text/plain", "Visible paste");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await expect(body).toContainText("Visible paste");
  await expect(body.locator("img")).toHaveCount(0);
  await expect(body.locator("b")).toHaveCount(0);
  expect(trackerRequests).toBe(0);

  await body.press("Control+A");
  await dialog.getByRole("button", { name: "Insert link" }).click();
  const linkDialog = dialog.getByRole("dialog", { name: "Insert link" });
  await linkDialog
    .getByRole("textbox", { name: "Link address" })
    .fill("javascript:alert(1)");
  await linkDialog.getByRole("button", { name: "Apply" }).click();
  await expect(linkDialog.getByRole("alert")).toContainText(
    "absolute http, https, or mailto",
  );
  await linkDialog.getByRole("button", { name: "Cancel" }).click();

  await body.press("Control+A");
  await dialog.getByRole("button", { name: "Bold" }).click();
  await dialog
    .getByRole("button", { name: "Switch to plain text" })
    .click();
  await expect(dialog.getByText("Switching to plain text will remove")).toBeVisible();
  await dialog.getByRole("button", { name: "Switch to plain text" }).last().click();
  const plainBody = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  await expect(plainBody).toHaveValue("Visible paste");
  await expectNoSeriousAccessibilityViolations(page);

  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await expect(dialog).toBeHidden();
  expect(submitted).toMatchObject({ body: "Visible paste" });
  expect(submitted).not.toHaveProperty("htmlBody");
});
