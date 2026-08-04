import { expect, test } from "@playwright/test";

import {
  testContactPrefix,
  useIsolatedContactMailbox,
} from "./support/contact-fixture";
import { expectNoSeriousAccessibilityViolations, mailSessionScopeHeaders } from "./support/mail-fixture";

useIsolatedContactMailbox();

test("manages contacts, groups, autocomplete, and vCard transfer", async ({ page }) => {
  const name = `${testContactPrefix} Ada`;
  const groupName = `${testContactPrefix} Team`;
  await page.getByRole("button", { name: "Contacts" }).click();
  const manager = page.getByRole("dialog", { name: "Contacts" });
  await expect(manager).toBeVisible();
  await manager.getByRole("button", { name: "New contact" }).click();
  const editor = page.getByRole("dialog", { name: "New contact" });
  await editor.getByLabel("Display name").fill(name);
  await editor.getByLabel("Email address 1").fill("e2e-ada@example.com");
  await editor.getByLabel("Label 1").fill("work");
  await editor.getByRole("button", { name: "Add email" }).click();
  await editor.getByLabel("Email address 2").fill("e2e-ada@home.example");
  const createResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/member/contacts") &&
    response.request().method() === "PUT" &&
    response.request().postDataJSON()?.operation === "create-contact",
  );
  await editor.getByRole("button", { name: "Save contact" }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(manager.getByText(name)).toBeVisible();
  await expect(manager.getByText(/e2e-ada@example\.com/)).toBeVisible();

  await manager.getByRole("tab", { name: "Groups" }).click();
  await manager.getByRole("button", { name: "New group" }).click();
  const groupEditor = page.getByRole("dialog", { name: "New group" });
  await groupEditor.getByLabel("Group name").fill(groupName);
  await groupEditor.getByText(name).click();
  await groupEditor.getByRole("button", { name: "Save group" }).click();
  await expect(manager.getByText(groupName)).toBeVisible();
  await expect(manager.getByText("1 member")).toBeVisible();

  const importResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/member/contacts/vcard") &&
    response.request().method() === "POST",
  );
  await manager.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from([
      "BEGIN:VCARD", "VERSION:4.0", `FN:${testContactPrefix} Grace`,
      "EMAIL:e2e-grace@example.com", `CATEGORIES:${testContactPrefix} Imported`,
      "END:VCARD", "",
    ].join("\r\n")),
    mimeType: "text/vcard",
    name: "contacts.vcf",
  });
  expect((await importResponse).status()).toBe(201);
  await manager.getByRole("tab", { name: "Contacts" }).click();
  await expect(manager.getByText(`${testContactPrefix} Grace`)).toBeVisible();
  await expect(manager.getByText(name)).toBeVisible();

  const download = page.waitForEvent("download");
  await manager.getByRole("button", { name: "Export" }).click();
  expect((await download).suggestedFilename()).toBe("veda-mail-contacts.vcf");
  await expectNoSeriousAccessibilityViolations(page);
  await manager.getByRole("button", { name: "Close contacts" }).click();

  const persisted = await page.request.get("/api/v1/member/contacts", {
    headers: await mailSessionScopeHeaders(page),
  });
  expect((await persisted.json()).data.contacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ name }),
  ]));

  await page.getByRole("button", { name: "New message" }).click();
  const composer = page.getByRole("dialog", { name: "Compose message" });
  const to = composer.getByRole("combobox", { name: "To" });
  await to.pressSequentially("e2e-ada");
  const listbox = composer.getByRole("listbox", { name: "To recipient suggestions" });
  const primaryOption = listbox.getByRole("option").filter({
    hasText: "e2e-ada@example.com",
  });
  await expect(primaryOption).toContainText(name);
  await to.press("ArrowDown");
  await to.press("Enter");
  await expect(to).toHaveValue(`"${name}" <e2e-ada@example.com>`);
  await expectNoSeriousAccessibilityViolations(page);
});
