import { expect, test } from "@playwright/test";
import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("snoozes a reader message with accessible local-time controls", async ({ page }) => {
  const snoozedMailboxId = "mock-snoozed-owned";
  let submitted: Record<string, unknown> | null = null;
  let submittedScope = "";
  await page.route("**/api/v1/mail/snoozed", async (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      submittedScope = route.request().headers()["x-veda-mail-session-scope"] ?? "";
      const item = (submitted["items"] as Array<Record<string, unknown>>)[0]!;
      await route.fulfill({ json: { data: {
        book: { messages: [{ attemptCount: 0, createdAt: new Date().toISOString(),
          from: ["priya@northstar.design"], id: "snooze-job-1", lastError: null,
          messageId: item["messageId"], status: "snoozed", subject: "Revised product roadmap · Q3",
          updatedAt: new Date().toISOString(), wakeAt: item["wakeAt"] }],
          revision: "snooze-revision-1", snoozedMailboxId, version: 1 },
        outcomes: [{ errorCode: null, messageId: item["messageId"], snoozeId: "snooze-job-1", status: "accepted" }],
      } }, status: 201 }); return;
    }
    await route.fulfill({ json: { data: {
      book: { messages: [], revision: null, snoozedMailboxId, version: 1 },
      capability: { maxMessages: 100, snoozedMailboxId, supported: true },
    } } });
  });
  await page.reload();
  await page.getByRole("button", { name: "Open Revised product roadmap · Q3" }).click();
  const trigger = page.getByRole("button", { name: "Snooze message" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: /Snooze/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Time zone:/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Later today/ })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole("button", { name: /Tomorrow/ }).click();
  await expect(dialog.getByText(/UTC:/)).not.toContainText("Choose a valid time");
  await dialog.getByRole("button", { name: "Snooze", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(submitted).toMatchObject({ items: [{ messageId: "msg-roadmap",
    sourceMailboxId: expect.any(String), wakeAt: expect.stringMatching(/Z$/u) }] });
  expect(submittedScope).not.toBe("");
});
