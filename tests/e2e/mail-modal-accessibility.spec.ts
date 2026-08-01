import { expect, test, type Page } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const enableProviderDrafts = async (page: Page) => {
  await page.route("**/api/v1/mail/workspace**", async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.draftCapability = { status: "supported" };
    await route.fulfill({ json: envelope, response });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "New message" })).toBeVisible();
};

const disableProviderDrafts = async (page: Page) => {
  await page.route("**/api/v1/mail/workspace**", async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.draftCapability = { status: "unsupported" };
    await route.fulfill({ json: envelope, response });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "New message" })).toBeVisible();
};

test("sign-out owns focus above composer and restores its trigger", async ({
  page,
}) => {
  const signOut = page.getByRole("button", { name: "Sign out" });
  await page.getByRole("button", { name: "New message" }).click();
  const composer = page.locator(
    '[role="dialog"][aria-label="Compose message"]',
  );
  await composer.getByRole("textbox", { name: "Message body" })
    .fill("Keep this unsaved message.");
  await signOut.focus();
  await signOut.evaluate((button) => (button as HTMLElement).click());

  const confirmation = page.getByRole("alertdialog", {
    name: "Sign out everywhere in this session?",
  });
  const cancel = confirmation.getByRole("button", { name: "Keep editing" });
  const confirm = confirmation.getByRole("button", {
    name: "Sign out everywhere",
  });
  await expect(cancel).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("main")).toHaveAttribute("inert", "");

  await confirm.focus();
  await confirm.press("Tab");
  await expect(cancel).toBeFocused();
  await cancel.press("Shift+Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Escape");

  await expect(confirmation).toBeHidden();
  await expect(composer).toBeVisible();
  await expect(composer.locator('[role="alertdialog"]')).toHaveCount(0);
  await expect(signOut).toBeFocused();
  await expect(page.locator("main")).not.toHaveAttribute("inert", "");
});

test("restoring recovery hands focus into the replacement composer", async ({
  page,
}) => {
  await disableProviderDrafts(page);
  await page.getByRole("button", { name: "New message" }).click();
  const composer = page.getByRole("dialog", { name: "Compose message" });
  await composer.getByRole("textbox", { name: "Message body" })
    .fill("Focus handoff recovery body.");
  await expect(composer.getByText("Saved locally", { exact: true }).first())
    .toBeVisible();

  await page.reload();
  const recovery = page.getByRole("alertdialog", {
    name: "Restore interrupted draft?",
  });
  const restore = recovery.getByRole("button", { name: "Restore draft" });
  await expect(restore).toBeFocused();
  await restore.click();

  const restored = page.getByRole("dialog", { name: "Compose message" });
  await expect(restored).toBeVisible();
  await expect(restored.getByRole("textbox", { exact: true, name: "To" }))
    .toBeFocused();
});

test("interrupted discard initially focuses the safe Not now action", async ({
  page,
}) => {
  const savedDraft = {
    composeId: "550e8400-e29b-41d4-a716-446655440010",
    content: {
      bcc: [], body: "Interrupted discard body", cc: [],
      subject: "Interrupted discard", to: [{
        email: "recipient@example.com", name: null,
      }],
    },
    hasAttachments: false,
    hasTruncatedContent: false,
    hasUncertainSubmission: false,
    id: "provider-modal-draft",
    revision: "modal-revision-a",
    updatedAt: "2026-08-01T10:00:00.000Z",
  };
  await page.route("**/api/v1/mail/drafts", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const input = route.request().postDataJSON();
    await route.fulfill({
      json: { data: {
        ...savedDraft, composeId: input.composeId, content: input.content,
      } },
      status: 201,
    });
  });
  await page.route(`**/api/v1/mail/drafts/${savedDraft.id}`, (route) =>
    route.abort("connectionrefused"));
  await enableProviderDrafts(page);

  await page.getByRole("button", { name: "New message" }).click();
  const composer = page.getByRole("dialog", { name: "Compose message" });
  await composer.getByRole("textbox", { exact: true, name: "To" })
    .fill("recipient@example.com");
  await composer.getByRole("textbox", { exact: true, name: "Message body" })
    .fill("Interrupted discard body");
  await composer.getByRole("button", { name: "Save draft" }).click();
  await expect(composer.getByText("Saved", { exact: true }).first()).toBeVisible();

  await composer.getByRole("button", { name: "Discard draft" }).click();
  const discard = composer.getByRole("alertdialog");
  const deletion = page.waitForRequest((request) =>
    request.method() === "DELETE" &&
    request.url().endsWith(`/api/v1/mail/drafts/${savedDraft.id}`));
  await discard.getByRole("button", {
    name: "Discard draft permanently",
  }).click();
  await deletion;
  await expect(composer.getByRole("alert")).toBeVisible();
  await page.reload();

  const recovery = page.getByRole("alertdialog", {
    name: "Finish interrupted discard?",
  });
  const notNow = recovery.getByRole("button", { name: "Not now" });
  const finish = recovery.getByRole("button", { name: "Finish exact discard" });
  await expect(notNow).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await finish.focus();
  await finish.press("Tab");
  await expect(notNow).toBeFocused();
  await notNow.press("Shift+Tab");
  await expect(finish).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(recovery).toBeHidden();
  await expect(page.locator("main")).not.toHaveAttribute("inert", "");
  await expectNoSeriousAccessibilityViolations(page);
});
