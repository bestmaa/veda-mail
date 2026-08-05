import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("preserves a stale snapshot and safely reconciles connectivity", async ({
  page,
}) => {
  const knownMessage = page.getByRole("button", {
    name: "Open Revised product roadmap · Q3",
  });
  await expect(knownMessage).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.getByRole("alert").filter({
    hasText: "You're offline. Mail shown below may be out of date.",
  })).toBeVisible();
  await expect(knownMessage).toBeVisible();

  await page.context().setOffline(false);
  await expect(page.getByRole("status").filter({
    hasText: "Back online. Mail is up to date.",
  })).toBeVisible();

  let workspaceRequests = 0;
  await page.route("**/api/v1/mail/workspace*", async (route) => {
    workspaceRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      body: JSON.stringify({ error: { code: "provider_unavailable",
        message: "Mailbox refresh is temporarily unavailable." } }),
      contentType: "application/json",
      status: 503,
    });
  });
  const refresh = page.getByRole("button", { name: "Refresh mail" });
  await refresh.click();
  await refresh.click();
  await expect(page.getByRole("alert").filter({
    hasText: "Mail may be out of date. Check your connection and retry.",
  })).toBeVisible();
  expect(workspaceRequests).toBe(1);
  await expect(knownMessage).toBeVisible();

  await page.unroute("**/api/v1/mail/workspace*");
  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page.getByRole("status").filter({
    hasText: "Back online. Mail is up to date.",
  })).toBeVisible();
});
