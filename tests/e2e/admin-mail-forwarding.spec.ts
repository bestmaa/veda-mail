import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  installApplication,
} from "./support/mail-fixture";

test.beforeEach(async ({ request }) => {
  await installApplication(request);
});

test("admin exclusively enables and disables automatic mailbox forwarding", async ({
  page,
}) => {
  const user = {
    aliases: ["team@example.com"], createdAt: "2026-08-23T00:00:00.000Z",
    displayName: "Ada Member", email: "ada@example.com", id: "account-1",
    locale: "en", maxDiskQuota: 1_000_000, timeZone: "Asia/Kolkata",
    usedDiskQuota: 1_024,
  };
  let forwarding: Record<string, unknown> | null = null;
  let revision = 0;
  const writes: Array<Record<string, unknown>> = [];

  await page.route("**/api/v1/admin/users**", async (route) => {
    const request = route.request();
    const parsed = new URL(request.url());
    const forwardingRoute = parsed.pathname.endsWith("/forwarding");
    if (parsed.pathname === "/api/v1/admin/users") {
      await route.fulfill({ json: { data: {
        adminTwoFactorEnabled: false, allowedDomains: ["example.com"],
        creation: { available: true, reason: null }, nextCursor: null,
        status: "available", users: [user],
      } } });
      return;
    }
    if (!forwardingRoute) {
      await route.fulfill({ json: { data: { user } } });
      return;
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push(body);
      revision += 2;
      forwarding = {
        destinationEmail: body["destinationEmail"], keepLocalCopy: true,
        sourceAddresses: [user.email, ...user.aliases], sourceEmail: user.email,
        status: "active", updatedAt: "2026-08-23T00:00:00.000Z",
      };
    } else if (request.method() === "DELETE") {
      writes.push(request.postDataJSON() as Record<string, unknown>);
      revision += 2; forwarding = null;
    }
    await route.fulfill({ json: { data: {
      availability: "available", configuration: forwarding,
      reason: null, revision,
    } } });
  });

  await page.goto("/admin/login");
  await page.getByLabel("Administrator username").fill("playwright-admin");
  await page.getByLabel("Administrator password").fill("Playwright123456");
  await page.getByRole("button", { name: "Open administration" }).click();
  await page.getByRole("button", { name: "Mailbox users" }).click();
  await page.getByRole("button", { name: /Ada Member/ }).click();

  const panel = page.getByRole("region", { name: "Automatic forwarding" });
  await expect(panel.getByText("Admin-only. A local copy is always kept.")).toBeVisible();
  await panel.getByLabel("External destination").fill("ada@gmail.com");
  await panel.getByLabel("Confirm destination").fill("ada@gmail.com");
  await panel.getByLabel("Administrator password").fill("Playwright123456");
  await panel.getByRole("button", { name: "Enable" }).click();

  await expect(panel.getByRole("status")).toHaveText("Automatic forwarding enabled.");
  await expect(panel).toContainText("Status: active");
  expect(writes[0]).toEqual({
    confirmDestinationEmail: "ada@gmail.com",
    currentAdminPassword: "Playwright123456",
    destinationEmail: "ada@gmail.com", expectedRevision: 0,
  });
  await expect(panel.getByLabel("Administrator password")).toHaveValue("");

  await panel.getByLabel("Administrator password").fill("Playwright123456");
  await panel.getByRole("button", { name: "Disable forwarding" }).click();
  await expect(panel.getByRole("status")).toHaveText("Automatic forwarding disabled.");
  await expect(panel.getByText("Status: active")).toBeHidden();
  expect(writes[1]).toEqual({
    currentAdminPassword: "Playwright123456", expectedRevision: 2,
  });
  await expectNoSeriousAccessibilityViolations(
    page, '[aria-labelledby="mail-forwarding-title"]',
  );
});
