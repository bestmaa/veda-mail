import { expect, test, type Page } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const providerDraft = {
  composeId: "550e8400-e29b-41d4-a716-446655440000",
  content: {
    bcc: [{ email: "hidden@example.com", name: null }],
    body: "Saved rich body",
    cc: [{ email: "copy@example.com", name: "Copy" }],
    htmlBody: "<p><strong>Saved rich body</strong></p>",
    subject: "Saved rich subject",
    to: [{ email: "recipient@example.com", name: "Recipient" }],
  },
  hasAttachments: false,
  hasTruncatedContent: false,
  hasUncertainSubmission: false,
  id: "provider-draft-a",
  revision: "revision-a",
  updatedAt: "2026-07-31T10:00:00.000Z",
};

const enableProviderDrafts = async (page: Page) => {
  await page.route("**/api/v1/mail/workspace**", async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.draftCapability = { status: "supported" };
    const drafts = envelope.data.mailboxes.find(
      (mailbox: { role: string }) => mailbox.role === "drafts",
    );
    if (drafts && new URL(route.request().url()).searchParams.get("mailboxId") === drafts.id) {
      envelope.data.messages = {
        items: [{
          from: [], hasAttachment: false, id: providerDraft.id,
          isStarred: false, isUnread: false, mailboxIds: [drafts.id],
          preview: providerDraft.content.body,
          receivedAt: providerDraft.updatedAt, size: 128,
          subject: providerDraft.content.subject, threadId: "draft-thread-a",
          to: providerDraft.content.to,
        }],
        nextCursor: null,
        total: 1,
      };
    }
    await route.fulfill({ json: envelope, response });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "New message" })).toBeVisible();
};

test("manually saves, keeps later edits dirty, and distinctly discards", async ({ page }) => {
  let createCount = 0;
  await page.route("**/api/v1/mail/attachments", (route) => route.fulfill({
    json: { data: { id: "upload-a", uploadUrl: "/api/v1/mail/attachments/upload-a" } },
    status: 201,
  }));
  await page.route("**/api/v1/mail/attachments/upload-a**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ json: { data: {
          expiresAt: "2026-07-31T11:00:00.000Z", id: "upload-a",
          mimeType: "text/plain", name: "local.txt", size: 16,
        } } })
      : route.fulfill({ status: 204 }));
  await page.route("**/api/v1/mail/drafts", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    createCount += 1;
    const input = route.request().postDataJSON();
    await route.fulfill({
      json: { data: { ...providerDraft, composeId: input.composeId, content: input.content } },
      status: 201,
    });
  });
  await page.route(`**/api/v1/mail/drafts/${providerDraft.id}`, async (route) => {
    if (route.request().method() === "DELETE") {
      expect(route.request().postDataJSON()).toEqual({ expectedRevision: "revision-a" });
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: { data: providerDraft } });
  });
  await enableProviderDrafts(page);

  const composeTrigger = page.getByRole("button", { name: "New message" });
  await composeTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await dialog.getByRole("textbox", { exact: true, name: "To" }).fill("recipient@example.com");
  await dialog.getByRole("textbox", { exact: true, name: "Message body" }).fill("Manual draft body");
  const save = dialog.getByRole("button", { name: "Save draft" });
  await expect(save).toBeEnabled();

  await dialog.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("local quarantine"), mimeType: "text/plain", name: "local.txt",
  });
  await expect(dialog.getByText("local.txt", { exact: true })).toBeVisible();
  await save.click();
  await expect(dialog.getByText("Remove local attachments before saving this provider draft.")).toBeVisible();
  expect(createCount).toBe(0);
  await dialog.getByRole("button", { name: "Remove local.txt" }).click();

  await save.click();
  await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
  expect(createCount).toBe(1);
  await expect(save).toBeDisabled();
  await dialog.getByRole("textbox", { exact: true, name: "Subject" }).fill("Newer edit");
  await expect(dialog.getByText("Unsaved", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Close composer" }).click();
  const closePrompt = dialog.getByRole("alertdialog");
  await expect(closePrompt.getByText("Close without saving")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await closePrompt.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog.getByRole("button", { name: "Close composer" })).toBeFocused();

  await dialog.getByRole("button", { name: "Discard draft" }).click();
  const discardPrompt = dialog.getByRole("alertdialog");
  await expect(discardPrompt.getByText("Discard draft permanently")).toBeVisible();
  await discardPrompt.getByRole("button", { name: "Discard draft permanently" }).click();
  await expect(dialog).toBeHidden();
  await expect(composeTrigger).toBeFocused();
});

test("opens a Drafts row through GET and requires Save after rich normalization", async ({ page }) => {
  let getCount = 0;
  await page.route(`**/api/v1/mail/drafts/${providerDraft.id}`, async (route) => {
    getCount += 1;
    await route.fulfill({ json: { data: providerDraft } });
  });
  await enableProviderDrafts(page);
  await page.getByRole("button", { name: /Drafts/ }).click();
  const row = page.getByRole("button", { name: "Edit draft Saved rich subject" });
  await row.click();

  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await expect(dialog.getByText("Edit draft", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { exact: true, name: "To" })).toHaveValue('"Recipient" <recipient@example.com>');
  await expect(dialog.getByRole("textbox", { exact: true, name: "Cc" })).toHaveValue('"Copy" <copy@example.com>');
  await expect(dialog.getByRole("textbox", { exact: true, name: "Bcc" })).toHaveValue("hidden@example.com");
  await expect(dialog.getByRole("textbox", { exact: true, name: "Message body" })).toContainText("Saved rich body");
  await expect(dialog.getByText("Unsaved", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Save changes before sending this provider draft.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save draft" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: /^Send$/ })).toBeDisabled();
  expect(getCount).toBe(1);
  await expectNoSeriousAccessibilityViolations(page);

  await dialog.getByRole("button", { name: "Close composer" }).click();
  await dialog.getByRole("button", { name: "Close without saving" }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
});

test("locks an uncertain send for review but permits exact discard", async ({ page }) => {
  const uncertain = { ...providerDraft, hasUncertainSubmission: true };
  let discardedRevision: string | null = null;
  await page.route(`**/api/v1/mail/drafts/${providerDraft.id}`, async (route) => {
    if (route.request().method() === "DELETE") {
      discardedRevision = route.request().postDataJSON().expectedRevision;
      return route.fulfill({ status: 204 });
    }
    await route.fulfill({ json: { data: uncertain } });
  });
  await enableProviderDrafts(page);
  await page.getByRole("button", { name: /Drafts/ }).click();
  await page.getByRole("button", { name: "Edit draft Saved rich subject" }).click();

  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await expect(dialog.getByText(/uncertain send outcome/)).toBeVisible();
  await expect(dialog.getByText(/Check Sent before continuing/)).toBeVisible();
  await expect(dialog.getByRole("textbox", { exact: true, name: "To" }))
    .toHaveAttribute("readonly", "");
  const body = dialog.getByRole("textbox", { exact: true, name: "Message body" });
  await expect(body).toHaveAttribute("aria-readonly", "true");
  await expect(body).toContainText("Saved rich body");
  await expect(dialog.getByRole("button", { name: /^Send$/ })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Save draft" })).toBeDisabled();

  await dialog.getByRole("button", { name: "Discard draft" }).click();
  await dialog.getByRole("button", { name: "Discard draft permanently" }).click();
  await expect(dialog).toBeHidden();
  expect(discardedRevision).toBe("revision-a");
});
