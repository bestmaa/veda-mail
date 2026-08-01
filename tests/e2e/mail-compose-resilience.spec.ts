import { expect, test } from "@playwright/test";

import {
  verifyAllRejectedDraft,
  verifyPartialDeliveryNotice,
} from "./support/compose-delivery-scenarios";
import { verifyDeliveryNoticePersistence } from "./support/delivery-notice-persistence-scenario";
import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

test("traps focus and safely locks an ambiguous provider send", async ({
  page,
}) => {
  const composeTrigger = page.getByRole("button", { name: "New message" });
  await composeTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  const toInput = dialog.getByRole("textbox", { exact: true, name: "To" });
  const bodyInput = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  const close = dialog.getByRole("button", { name: "Close composer" });
  const discard = dialog.getByRole("button", { name: "Discard draft" });

  await expect(toInput).toBeFocused();
  await close.focus();
  await close.press("Shift+Tab");
  await expect(discard).toBeFocused();
  await discard.press("Tab");
  await expect(close).toBeFocused();

  await bodyInput.fill("Keep this draft after every recoverable error.");
  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Add at least one recipient.",
  );
  await expect(bodyInput).toContainText(
    "Keep this draft after every recoverable error.",
  );

  await toInput.fill("recipient@example.com");
  await dialog
    .getByRole("textbox", { exact: true, name: "Subject" })
    .fill("Recoverable provider error");

  let releaseSend: () => void = () => undefined;
  const pendingSend = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });
  await page.route("**/api/v1/mail/send", async (route) => {
    await pendingSend;
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "Mail provider is temporarily unavailable.",
        },
      }),
      contentType: "application/json",
      status: 502,
    });
  });

  const sendRequest = page.waitForRequest("**/api/v1/mail/send");
  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await sendRequest;
  await expect(dialog.getByRole("button", { name: /^Sending/ })).toBeDisabled();
  await expect(toInput).toBeDisabled();
  await expect(bodyInput).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  releaseSend();
  await expect(dialog.getByRole("alert")).toContainText(
    "This message may already have been sent.",
  );
  await expect(dialog.getByRole("alert")).toContainText("Check Sent");
  await expect(toInput).toHaveValue("recipient@example.com");
  await expect(bodyInput).toContainText(
    "Keep this draft after every recoverable error.",
  );
  await expect(toInput).toHaveAttribute("readonly", "");
  await expect(bodyInput).toHaveAttribute("aria-readonly", "true");
  await expect(dialog.getByRole("button", { name: /^Send$/ })).toBeDisabled();
  await expect(discard).toBeDisabled();

  const resume = dialog.getByRole("button", {
    name: "I checked Sent — resume as draft",
  });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(resume).toBeHidden();
  await expect(toInput).not.toHaveAttribute("readonly", "");
  await expect(bodyInput).toHaveAttribute("aria-readonly", "false");
  await expect(dialog.getByRole("button", { name: /^Send$/ })).toBeEnabled();
  await expect(toInput).toHaveValue("recipient@example.com");
  await expect(bodyInput).toContainText(
    "Keep this draft after every recoverable error.",
  );
  await expectNoSeriousAccessibilityViolations(page);
});

test(
  "closes a partially delivered draft and warns against duplicate sends",
  verifyPartialDeliveryNotice,
);

test(
  "keeps an all-rejected draft and ready attachment available for correction",
  verifyAllRejectedDraft,
);

test(
  "hydrates, deduplicates, and restores a failed persisted dismissal",
  verifyDeliveryNoticePersistence,
);
