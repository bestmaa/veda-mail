import { expect, test } from "@playwright/test";
import type { Response } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const mailboxResponse = (method: "DELETE" | "PATCH" | "POST") =>
  (response: Response) =>
    response.url().endsWith("/api/v1/mail/mailboxes") &&
    response.request().method() === method;

const expectSuccessfulResponse = async (response: Response) => {
  const body = await response.text();
  expect(
    response.ok(),
    `Expected ${response.request().method()} ${response.url()} to succeed; ` +
      `received ${response.status()}: ${body}`,
  ).toBe(true);
};

test("creates, nests, recolors, renames, and safely deletes custom mailboxes", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Create mailbox" }).click();
  let dialog = page.getByRole("dialog", { name: "Create mailbox" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Name" }).fill("E2E Projects");
  await dialog.getByRole("radio", { name: "#a855f7" }).check();
  const createParent = page.waitForResponse(mailboxResponse("POST"));
  await dialog.getByRole("button", { name: "Create" }).click();
  expect((await createParent).status()).toBe(201);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Manage E2E Projects" })).toBeVisible();

  await page.getByRole("button", { name: "Create mailbox" }).click();
  dialog = page.getByRole("dialog", { name: "Create mailbox" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("E2E Client");
  await dialog.getByLabel("Parent mailbox").selectOption({ label: "E2E Projects" });
  const createChild = page.waitForResponse(mailboxResponse("POST"));
  await dialog.getByRole("button", { name: "Create" }).click();
  expect((await createChild).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Manage E2E Client" })).toBeVisible();

  await page.getByRole("button", { name: "Manage E2E Client" }).click();
  dialog = page.getByRole("dialog", { name: "Edit mailbox" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("E2E Client Alpha");
  await dialog.getByRole("radio", { name: "#ec4899" }).check();
  const update = page.waitForResponse(mailboxResponse("PATCH"));
  await dialog.getByRole("button", { name: "Save" }).click();
  expect((await update).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Manage E2E Client Alpha" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Manage E2E Client Alpha" })).toBeVisible();

  await page.getByRole("button", { name: "Manage E2E Client Alpha" }).click();
  dialog = page.getByRole("dialog", { name: "Edit mailbox" });
  await expectNoSeriousAccessibilityViolations(page);
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog.getByText("This cannot be undone")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByText("This cannot be undone")).toBeHidden();
  await dialog.getByRole("button", { name: "Delete" }).click();
  const deleteChild = page.waitForResponse(mailboxResponse("DELETE"));
  await dialog.getByRole("button", { name: "Delete mailbox" }).click();
  await expectSuccessfulResponse(await deleteChild);
  await expect(page.getByRole("button", { name: "Manage E2E Client Alpha" })).toHaveCount(0);

  await page.getByRole("button", { name: "Manage E2E Projects" }).click();
  dialog = page.getByRole("dialog", { name: "Edit mailbox" });
  await dialog.getByRole("button", { name: "Delete" }).click();
  const deleteParent = page.waitForResponse(mailboxResponse("DELETE"));
  await dialog.getByRole("button", { name: "Delete mailbox" }).click();
  await expectSuccessfulResponse(await deleteParent);
  await expect(page.getByRole("button", { name: "Manage E2E Projects" })).toHaveCount(0);
});
