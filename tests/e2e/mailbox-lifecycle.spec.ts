import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("requires an accessible confirmation before emptying Trash", async ({
  page,
}) => {
  const baselineResponse = await page.request.get("/api/v1/mail/workspace");
  expect(baselineResponse.ok()).toBe(true);
  const baseline = (await baselineResponse.json()) as {
    data: {
      mailboxes: Array<{
        id: string;
        rights: { mayRemoveItems?: boolean };
        role: string;
        total: number;
      }>;
      messages: {
        items: Array<Record<string, unknown>>;
        nextCursor: string | null;
        total: number;
      };
    };
  };
  let trashId = "";
  const emptyBodies: Array<Record<string, unknown>> = [];

  await page.route("**/api/v1/mail/workspace**", async (route) => {
    const envelope = structuredClone(baseline);
    const trash = envelope.data.mailboxes.find(
      (mailbox) => mailbox.role === "trash",
    );
    trashId = trash?.id ?? "";
    const first = envelope.data.messages.items[0];
    if (!first || !trash) throw new Error("Trash lifecycle fixture is incomplete.");
    trash.total = 1;
    trash.rights.mayRemoveItems = true;

    const requestedMailbox = new URL(route.request().url()).searchParams.get(
      "mailboxId",
    );
    if (requestedMailbox === trashId) {
      envelope.data.messages = {
        items: [{ ...first, mailboxIds: [trashId], subject: "Lifecycle test" }],
        nextCursor: null,
        total: 1,
      };
    }
    await route.fulfill({ json: envelope, status: 200 });
  });
  await page.route("**/api/v1/mail/mailboxes/empty", async (route) => {
    emptyBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const prepared = emptyBodies.length === 1;
    await route.fulfill({
      json: {
        data: prepared
          ? { complete: false, processed: 0, removed: 0 }
          : { complete: true, processed: 1, removed: 1 },
      },
      status: prepared ? 202 : 200,
    });
  });

  await page.reload();
  await page.getByRole("button", { name: /^Trash/ }).click();
  await expect(page.getByLabel("Trash lifecycle")).toContainText(
    "automatically remove messages",
  );

  const emptyButton = page.getByRole("button", { name: "Empty Trash" });
  await emptyButton.click();
  const dialog = page.getByRole("alertdialog", {
    name: "Empty Trash permanently?",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(emptyButton).toBeFocused();
  expect(emptyBodies).toHaveLength(0);

  await emptyButton.click();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(emptyButton).toBeFocused();
  expect(emptyBodies).toHaveLength(0);

  await emptyButton.click();
  await dialog.getByRole("button", { name: "Empty Trash permanently" }).click();
  await expect(page.getByText("1 message permanently deleted.")).toBeAttached();
  expect(emptyBodies).toEqual([{ mailboxId: trashId }, { mailboxId: trashId }]);
});
