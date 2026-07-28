import { expect, test, type Page } from "@playwright/test";
import {
  expectNoSeriousAccessibilityViolations,
  sendComposer,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const openRoadmapMessage = async (page: Page) => {
  await page
    .getByRole("button", { name: "Open Revised product roadmap · Q3" })
    .click();
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
  await expect(reader.getByText("Q3-roadmap.pdf", { exact: true })).toBeVisible();
  await expect(reader.getByText(/application\/pdf.*2\.3 MB/)).toBeVisible();
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
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
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
  ).toHaveValue(/---------- Forwarded message ----------/);
  await page.keyboard.press("Escape");
  await expect(forward).toBeFocused();
});

test("submits Reply All and Forward with the correct threading payload", async ({
  page,
}) => {
  const sentPayloads: Record<string, unknown>[] = [];
  await page.route("**/api/v1/mail/send", async (route) => {
    sentPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
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
  await bodyInput.fill(`Reply accepted.\n${await bodyInput.inputValue()}`);
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

  expect(sentPayloads[1]).toMatchObject({
    bcc: [],
    cc: [],
    subject: "Fwd: Revised product roadmap · Q3",
    to: [{ email: "colleague@example.com", name: null }],
  });
  expect(sentPayloads[1]).not.toHaveProperty("inReplyTo");
  expect(sentPayloads[1]?.["body"]).toMatch(
    /---------- Forwarded message ----------[\s\S]*I added the revised delivery milestones/,
  );
});
