import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("bulk updates loaded messages and keeps only failures selected", async ({
  page,
}) => {
  let firstId = "";
  const secondId = "message-bulk-second";
  let requestBody: Record<string, unknown> | null = null;
  await page.route("**/api/v1/mail/workspace**", async (route) => {
    const response = await route.fetch();
    const envelope = (await response.json()) as {
      data: {
        messages: {
          items: Array<Record<string, unknown>>;
          nextCursor: string | null;
          total: number;
        };
      };
    };
    const first = envelope.data.messages.items[0];
    if (!first) throw new Error("The bulk fixture requires one message.");
    firstId = String(first["id"]);
    envelope.data.messages = {
      items: [
        first,
        {
          ...first,
          id: secondId,
          subject: "Bulk action follow-up",
          threadId: "thread-bulk-second",
        },
      ],
      nextCursor: null,
      total: 2,
    };
    await route.fulfill({ json: envelope, response });
  });
  await page.route("**/api/v1/mail/messages/bulk", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: {
        data: { failed: [secondId], succeeded: [firstId] },
      },
      status: 200,
    });
  });
  await page.reload();

  const firstSelection = page.getByRole("checkbox", {
    name: "Select Your Stalwart workspace is ready",
  });
  const secondSelection = page.getByRole("checkbox", {
    name: "Select Bulk action follow-up",
  });
  await firstSelection.check();
  await secondSelection.check();
  await expect(page.getByText("2 selected")).toBeVisible();

  await page.getByRole("button", {
    name: "Mark selected messages as unread",
  }).click();

  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(firstSelection).not.toBeChecked();
  await expect(secondSelection).toBeChecked();
  await expect(page.getByText(
    "1 updated; 1 failed and remain selected.",
  )).toBeAttached();
  expect(requestBody).toEqual({
    messageIds: [firstId, secondId],
    type: "set-read",
    value: false,
  });
});

test("requires confirmation before permanent bulk deletion", async ({ page }) => {
  let trashId = "";
  let trashMessageId = "";
  let messageFixture: Record<string, unknown> | null = null;
  let destroyRequests = 0;
  let destroyBody: Record<string, unknown> | null = null;
  await page.route("**/api/v1/mail/workspace**", async (route) => {
    const response = await route.fetch();
    const envelope = (await response.json()) as {
      data: {
        mailboxes: Array<{ id: string; role: string; total: number }>;
        messages: {
          items: Array<Record<string, unknown>>;
          nextCursor: string | null;
          total: number;
        };
      };
    };
    trashId = envelope.data.mailboxes.find(
      (mailbox) => mailbox.role === "trash",
    )?.id ?? "";
    const currentFirst = envelope.data.messages.items[0];
    if (currentFirst) messageFixture = currentFirst;
    const first = currentFirst ?? messageFixture;
    if (!first || !trashId) throw new Error("Trash fixture is incomplete.");
    trashMessageId = String(first["id"]);
    const requestedMailbox = new URL(route.request().url()).searchParams.get(
      "mailboxId",
    );
    if (requestedMailbox === trashId) {
      envelope.data.messages = {
        items: [{ ...first, mailboxIds: [trashId], subject: "Delete forever" }],
        nextCursor: null,
        total: 1,
      };
      const trash = envelope.data.mailboxes.find(
        (mailbox) => mailbox.id === trashId,
      );
      if (trash) trash.total = 1;
    }
    await route.fulfill({ json: envelope, response });
  });
  await page.route("**/api/v1/mail/messages/bulk", async (route) => {
    destroyRequests += 1;
    destroyBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: { data: { failed: [], succeeded: [trashMessageId] } },
      status: 200,
    });
  });
  await page.reload();
  await page.getByRole("button", { name: /^Trash/ }).click();
  await page.getByRole("checkbox", { name: "Select Delete forever" }).check();

  await page.getByRole("button", {
    name: "Permanently delete selected messages",
  }).click();
  const dialog = page.getByRole("alertdialog", {
    name: "Permanently delete 1 message?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
  expect(destroyRequests).toBe(0);

  await page.getByRole("button", {
    name: "Permanently delete selected messages",
  }).click();
  await dialog.getByRole("button", { name: "Permanently delete" }).click();
  await expect(page.getByText("1 message updated.")).toBeAttached();
  expect(destroyRequests).toBe(1);
  expect(destroyBody).toEqual({
    mailboxId: trashId,
    messageIds: [trashMessageId],
    type: "destroy",
  });
});
