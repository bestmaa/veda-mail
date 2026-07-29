import { expect, test } from "@playwright/test";
import {
  expectNoSeriousAccessibilityViolations,
  sendComposer,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

test("sends CC-only and BCC-only mail with accessible disclosures", async ({
  page,
}) => {
  const composeTrigger = page.getByRole("button", { name: "New message" });
  await expectNoSeriousAccessibilityViolations(page);
  await composeTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  const toInput = dialog.getByRole("textbox", { exact: true, name: "To" });
  const ccToggle = dialog.getByRole("button", { exact: true, name: "Cc" });
  const bccToggle = dialog.getByRole("button", { exact: true, name: "Bcc" });

  await expect(toInput).toBeFocused();
  await expect(ccToggle).toHaveAttribute("aria-expanded", "false");
  await ccToggle.focus();
  await ccToggle.press("Enter");
  await expect(ccToggle).toHaveAttribute("aria-expanded", "true");
  await expect(ccToggle).toBeFocused();
  await ccToggle.press("Enter");
  await expect(ccToggle).toHaveAttribute("aria-expanded", "false");
  await expect(ccToggle).toBeFocused();

  await bccToggle.focus();
  await bccToggle.press("Enter");
  await expect(bccToggle).toHaveAttribute("aria-expanded", "true");
  await expect(bccToggle).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page);
  await dialog
    .getByRole("textbox", { exact: true, name: "Bcc" })
    .fill("hidden@example.com");
  await bccToggle.click();
  await expect(bccToggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    dialog.getByRole("textbox", { exact: true, name: "Bcc" }),
  ).toHaveValue("hidden@example.com");
  await dialog
    .getByRole("textbox", { exact: true, name: "Subject" })
    .fill("BCC-only acceptance");
  await dialog
    .getByRole("textbox", { exact: true, name: "Message body" })
    .fill("Private envelope test");

  const bccRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/mail/send"),
  );
  await sendComposer(page);
  expect((await bccRequest).postDataJSON()).toMatchObject({
    bcc: [{ email: "hidden@example.com", name: null }],
    cc: [],
    to: [],
  });
  await expect(composeTrigger).toBeFocused();

  await composeTrigger.click();
  await dialog.getByRole("button", { exact: true, name: "Cc" }).click();
  await dialog
    .getByRole("textbox", { exact: true, name: "Cc" })
    .fill("copy@example.com");
  await dialog
    .getByRole("textbox", { exact: true, name: "Subject" })
    .fill("CC-only acceptance");
  await dialog
    .getByRole("textbox", { exact: true, name: "Message body" })
    .fill("Visible copy test");
  const ccRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/mail/send"),
  );
  await sendComposer(page);
  expect((await ccRequest).postDataJSON()).toMatchObject({
    bcc: [],
    cc: [{ email: "copy@example.com", name: null }],
    to: [],
  });

  await page.getByRole("button", { name: /Sent/ }).click();
  await expect(
    page.getByRole("button", { name: "Open CC-only acceptance" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open BCC-only acceptance" }),
  ).toBeVisible();
});

test("keeps the expanded composer inside a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.reload();
  await page.getByRole("button", { name: "Compose a new message" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await dialog.getByRole("button", { exact: true, name: "Cc" }).click();
  await dialog.getByRole("button", { exact: true, name: "Bcc" }).click();

  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(bounds?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("uploads, removes, scans, and sends an attachment", async ({ page }) => {
  await page.getByRole("button", { name: "New message" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await dialog
    .getByRole("textbox", { exact: true, name: "To" })
    .fill("recipient@example.com");
  await dialog
    .getByRole("textbox", { exact: true, name: "Subject" })
    .fill("Attachment acceptance");
  await dialog
    .getByRole("textbox", { exact: true, name: "Message body" })
    .fill("The scanned file is attached.");
  const picker = dialog.locator('input[type="file"]');

  await picker.setInputFiles({
    buffer: Buffer.from("remove this copy"),
    mimeType: "text/plain",
    name: "first.txt",
  });
  await expect(dialog.getByText("first.txt", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/text\/plain/)).toBeVisible();
  await dialog.getByRole("button", { name: "Remove first.txt" }).click();
  await expect(dialog.getByText("first.txt", { exact: true })).toBeHidden();

  await picker.setInputFiles({
    buffer: Buffer.from("byte-identical attachment"),
    mimeType: "text/plain",
    name: "evidence.txt",
  });
  await expect(dialog.getByText("evidence.txt", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/text\/plain/)).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  const sendRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/mail/send"),
  );
  await sendComposer(page);
  const payload = (await sendRequest).postDataJSON() as {
    attachmentIds: string[];
    draftId: string;
  };
  expect(payload.attachmentIds).toHaveLength(1);
  expect(payload.attachmentIds[0]).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(payload.draftId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  await page.getByRole("button", { name: /Sent/ }).click();
  await page
    .getByRole("button", { name: "Open Attachment acceptance" })
    .click();
  await expect(page.getByText("evidence.txt", { exact: true })).toBeVisible();
  await expect(page.getByText(/text\/plain/)).toBeVisible();
});
