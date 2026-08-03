import { expect, test, type Page } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const summary = (
  id: string,
  subject: string,
  receivedAt: string,
  sender: string,
) => ({
  from: [{ email: `${sender.toLowerCase()}@example.com`, name: sender }],
  hasAttachment: false,
  id,
  isStarred: false,
  isUnread: id.endsWith("older"),
  labelIds: [],
  mailboxIds: ["mock-inbox"],
  preview: `${subject} preview`,
  receivedAt,
  size: 120,
  subject,
  threadId: "thread-roadmap",
  to: [{ email: "member@example.com", name: "Sample Member" }],
});

const installConversation = async (page: Page) => {
  let requestCount = 0;
  const earlier = summary(
    "msg-roadmap-older",
    "Roadmap kickoff",
    "2026-07-22T04:18:00.000Z",
    "Ada",
  );
  const current = summary(
    "msg-roadmap",
    "Revised product roadmap · Q3",
    "2026-07-23T04:18:00.000Z",
    "Priya",
  );
  await page.route("**/api/v1/mail/messages/*/conversation*", async (route) => {
    requestCount += 1;
    const anchor = route.request().url().includes("msg-roadmap-older")
      ? "msg-roadmap-older"
      : "msg-roadmap";
    await route.fulfill({
      body: JSON.stringify({ data: {
        anchorMessageId: anchor,
        items: [earlier, current],
        nextCursor: null,
        strategy: "native",
        total: 2,
        truncated: false,
      } }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/v1/mail/messages/msg-roadmap-older", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ data: {
        ...earlier,
        attachments: [],
        cc: [],
        htmlBody: null,
        replyTo: [],
        textBody: "The first roadmap note.",
      } }),
      contentType: "application/json",
      status: 200,
    });
  });
  return () => requestCount;
};

test("opens a provider conversation and changes the expanded message from the keyboard", async ({
  page,
}) => {
  const conversationRequests = await installConversation(page);
  await page.getByRole("button", { name: "Open Revised product roadmap · Q3" }).click();

  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(conversation).toContainText("Conversation · 2");
  await expect(conversation).toContainText("Provider thread");
  const earlier = conversation.getByRole("button", { name: /Ada.*Roadmap kickoff/ });
  await earlier.focus();
  await expect(earlier).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Roadmap kickoff" })).toBeVisible();
  await expect(conversation.getByRole("button", { name: /Ada.*Roadmap kickoff/ }))
    .toHaveAttribute("aria-current", "true");
  expect(conversationRequests()).toBe(1);
  await expectNoSeriousAccessibilityViolations(page);
});

test("keeps the bounded conversation usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await installConversation(page);
  await page.getByRole("button", { name: "Open Revised product roadmap · Q3" }).click();
  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(conversation).toBeVisible();
  await expect(conversation.getByRole("button")).toHaveCount(2);
});
