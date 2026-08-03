import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectNoSeriousAccessibilityViolations,
  mailSessionScopeHeaders,
  sendComposer,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const openRoadmapMessage = async (page: Page) => {
  await page
    .getByRole("button", { name: "Open Revised product roadmap · Q3" })
    .click();
};

const closeUnsavedComposer = async (page: Page, dialog: Locator) => {
  await page.keyboard.press("Escape");
  const warning = dialog.getByRole("alertdialog", {
    name: "Close with unsaved changes?",
  });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Close without saving" }).click();
  await expect(dialog).toBeHidden();
};

test("shows message metadata and derives Reply All and Forward drafts", async ({
  page,
}) => {
  await openRoadmapMessage(page);
  const reader = page.getByRole("article");
  await expect(
    reader.getByText("to member@example.com", { exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByText("cc owner@example.com", { exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByText("Q3-roadmap.pdf", { exact: true }),
  ).toBeVisible();
  await expect(reader.getByText(/application\/pdf.*51 B/)).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  const replyAll = page.getByRole("button", { name: "Reply all" });
  await replyAll.click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await expect(
    dialog.getByRole("textbox", { exact: true, name: "Message body" }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("textbox", { exact: true, name: "To" }),
  ).toHaveValue('"Priya Menon" <priya@northstar.design>');
  await expect(
    dialog.getByRole("textbox", { exact: true, name: "Cc" }),
  ).toHaveValue('"Owner" <owner@example.com>');
  await expect(
    dialog.getByRole("textbox", { exact: true, name: "To" }),
  ).not.toHaveValue(/member@example.com/);
  await closeUnsavedComposer(page, dialog);
  await expect(replyAll).toBeFocused();

  const forward = page.getByRole("button", { name: "Forward" });
  await forward.click();
  await expect(
    dialog.getByRole("textbox", { exact: true, name: "To" }),
  ).toHaveValue("");
  await expect(
    dialog.getByRole("textbox", { exact: true, name: "Subject" }),
  ).toHaveValue("Fwd: Revised product roadmap · Q3");
  await expect(
    dialog.getByRole("textbox", { exact: true, name: "Message body" }),
  ).toContainText(/---------- Forwarded message ----------/);
  await closeUnsavedComposer(page, dialog);
  await expect(forward).toBeFocused();
});

test("downloads an attachment byte-identically from the keyboard", async ({
  page,
  request,
}) => {
  const expected = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  );
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  await openRoadmapMessage(page);
  const downloadButton = page.getByRole("button", {
    name: "Download Q3-roadmap.pdf",
  });
  await downloadButton.focus();
  await expect(downloadButton).toBeFocused();
  const downloadEvent = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const download = await downloadEvent;

  expect(download.suggestedFilename()).toBe("Q3-roadmap.pdf");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const received = await readFile(downloadPath ?? "");
  expect(createHash("sha256").update(received).digest("hex")).toBe(
    expectedHash,
  );

  const href =
    "/api/v1/mail/messages/msg-roadmap/attachments/attachment-roadmap";
  const scopeHeaders = await mailSessionScopeHeaders(page);
  const response = await page.request.get(href ?? "", {
    headers: {
      origin: "http://127.0.0.1:3101",
      ...scopeHeaders,
    },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/octet-stream");
  expect(response.headers()["cache-control"]).toBe(
    "private, no-store, no-transform, max-age=0",
  );
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(
    createHash("sha256")
      .update(await response.body())
      .digest("hex"),
  ).toBe(expectedHash);

  const unauthenticated = await request.get(href ?? "", {
    headers: { origin: "http://127.0.0.1:3101" },
  });
  expect(unauthenticated.status()).toBe(401);
});

test("submits Reply All and Forward with the correct threading payload", async ({
  page,
}) => {
  const sentPayloads: Record<string, unknown>[] = [];
  const savedDraftPayloads: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" && request.method() !== "PUT") return;
    if (!/\/api\/v1\/mail\/drafts(?:\/[^/]+)?$/u.test(request.url())) return;
    savedDraftPayloads.push(request.postDataJSON() as Record<string, unknown>);
  });
  await page.route("**/api/v1/mail/send", async (route) => {
    sentPayloads.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    await route.fulfill({
      body: JSON.stringify({
        data: {
          id: `accepted-${sentPayloads.length}`,
          submittedAt: "2026-07-29T00:00:00.000Z",
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });

  await openRoadmapMessage(page);
  await page.getByRole("button", { name: "Reply all" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  const bodyInput = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  await expect(bodyInput).toBeFocused();
  await bodyInput.fill(`Reply accepted.\n${await bodyInput.textContent()}`);
  await sendComposer(page);

  expect(sentPayloads[0]).toMatchObject({
    bcc: [],
    cc: [{ email: "owner@example.com", name: "Owner" }],
    inReplyTo: "msg-roadmap",
    subject: "Re: Revised product roadmap · Q3",
    to: [{ email: "priya@northstar.design", name: "Priya Menon" }],
  });

  await page.getByRole("button", { name: "Forward" }).click();
  await dialog
    .getByRole("textbox", { exact: true, name: "To" })
    .fill("colleague@example.com");
  await sendComposer(page);

  const forwarded = sentPayloads[1]!;
  expect(forwarded).toMatchObject({
    bcc: [],
    cc: [],
    draftId: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    ),
    subject: "Fwd: Revised product roadmap · Q3",
    to: [{ email: "colleague@example.com", name: null }],
  });
  if (forwarded["providerDraftId"]) {
    expect(forwarded).toMatchObject({
      attachmentIds: [],
      expectedDraftRevision: expect.stringMatching(/^mock-revision-/u),
      providerDraftId: expect.stringMatching(/^mock-draft-/u),
    });
    expect(savedDraftPayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        attachmentIds: [expect.stringMatching(/^[A-Za-z0-9_-]{32}$/u)],
      }),
    ]));
  } else {
    expect(forwarded).toMatchObject({
      attachmentIds: [expect.stringMatching(/^[A-Za-z0-9_-]{32}$/u)],
    });
  }
  expect(sentPayloads[1]).not.toHaveProperty("inReplyTo");
  expect(sentPayloads[1]?.["body"]).toMatch(
    /---------- Forwarded message ----------[\s\S]*I added the revised delivery milestones/,
  );
});
