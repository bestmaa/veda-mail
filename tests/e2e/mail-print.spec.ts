import { expect, test, type Page } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

const printableMessage = (id: string, subject: string, body: string) => ({
  attachments: id === "msg-roadmap"
    ? [{ mimeType: "application/pdf", name: "Q3-roadmap.pdf", size: 51 }]
    : [],
  cc: [],
  from: [{ email: "sender@example.com", name: "Sender" }],
  htmlBody: `<p>${body}</p>`,
  id,
  receivedAt: "2026-07-23T04:18:00.000Z",
  replyTo: [],
  size: 512,
  subject,
  textBody: body,
  to: [{ email: "member@example.com", name: "Sample Member" }],
});

const installPrintCapture = async (page: Page) => {
  const capture = () => {
    window.print = () => {
      document.documentElement.dataset["vedaPrintInvoked"] = "true";
    };
  };
  await page.addInitScript(capture);
  await page.evaluate(capture);
};

test("prints the selected message through a bounded same-origin request", async ({ page }) => {
  await installPrintCapture(page);
  let printPayload: unknown = null;
  await page.route("**/api/v1/mail/messages/msg-roadmap/print", async (route) => {
    printPayload = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify({ data: {
        anchorMessageId: "msg-roadmap",
        messages: [printableMessage(
          "msg-roadmap",
          "Revised product roadmap · Q3",
          "Printable roadmap body",
        )],
        scope: "message",
        total: 1,
        truncated: false,
      } }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.getByRole("button", { name: "Open Revised product roadmap · Q3" }).click();
  await page.getByRole("button", { name: "Print message" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-veda-print-invoked", "true");
  await expect(page.locator(".veda-print-root")).toContainText("Printable roadmap body");
  await expect(page.locator(".veda-print-root")).toContainText("Q3-roadmap.pdf (51 B)");
  expect(printPayload).toEqual({ scope: "message" });
});

test("offers and prints a complete provider-neutral conversation", async ({ page }) => {
  await installPrintCapture(page);
  await page.route("**/api/v1/mail/messages/*/conversation*", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ data: {
        anchorMessageId: "msg-roadmap",
        items: [{
          from: [{ email: "older@example.com", name: "Older" }],
          hasAttachment: false,
          id: "msg-older",
          isStarred: false,
          isUnread: false,
          labelIds: [],
          mailboxIds: ["mock-inbox"],
          preview: "Older body",
          receivedAt: "2026-07-22T04:18:00.000Z",
          size: 128,
          subject: "Roadmap kickoff",
          threadId: "thread-roadmap",
          to: [{ email: "member@example.com", name: null }],
        }, {
          from: [{ email: "sender@example.com", name: "Sender" }],
          hasAttachment: true,
          id: "msg-roadmap",
          isStarred: false,
          isUnread: false,
          labelIds: [],
          mailboxIds: ["mock-inbox"],
          preview: "Current body",
          receivedAt: "2026-07-23T04:18:00.000Z",
          size: 512,
          subject: "Revised product roadmap · Q3",
          threadId: "thread-roadmap",
          to: [{ email: "member@example.com", name: null }],
        }],
        nextCursor: null,
        strategy: "native",
        total: 2,
        truncated: false,
      } }),
      contentType: "application/json",
      status: 200,
    });
  });
  let printPayload: unknown = null;
  await page.route("**/api/v1/mail/messages/msg-roadmap/print", async (route) => {
    printPayload = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify({ data: {
        anchorMessageId: "msg-roadmap",
        messages: [
          printableMessage("msg-older", "Roadmap kickoff", "Older printable body"),
          printableMessage("msg-roadmap", "Revised product roadmap · Q3", "Current printable body"),
        ],
        scope: "conversation",
        total: 2,
        truncated: false,
      } }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.getByRole("button", { name: "Open Revised product roadmap · Q3" }).click();
  await page.getByRole("button", { name: "Print conversation" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-veda-print-invoked", "true");
  await expect(page.locator(".veda-print-root .veda-print-message")).toHaveCount(2);
  await expect(page.locator(".veda-print-root")).toContainText("Older printable body");
  await expect(page.locator(".veda-print-root")).toContainText("Current printable body");
  expect(printPayload).toEqual({ scope: "conversation" });
});
