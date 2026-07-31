import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("sign-out removes cached mailbox DOM from every matching tab", async ({
  context,
  page,
}) => {
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByRole("button", { name: "New message" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign out everywhere" }).click();

  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(second.getByLabel("Email address")).toBeVisible();
  await expect(second.getByRole("button", { name: "New message" })).toHaveCount(0);
  await expect(second.getByRole("dialog", { name: "Compose message" }))
    .toHaveCount(0);
  await second.close();
});
