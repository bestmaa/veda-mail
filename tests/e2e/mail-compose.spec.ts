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
