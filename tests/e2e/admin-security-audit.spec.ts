import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  installApplication,
} from "./support/mail-fixture";

test.beforeEach(async ({ request }) => {
  await installApplication(request);
});

test("shows verified, privacy-bounded administrator security evidence", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await page.getByLabel("Administrator username").fill("playwright-admin");
  await page.getByLabel("Administrator password").fill("Playwright123456");
  await page.getByRole("button", { name: "Open administration" }).click();
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

  const response = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/v1/admin/audit") && candidate.ok());
  await page.getByRole("button", { name: "Audit log" }).click();
  await response;

  const audit = page.getByRole("region", { name: "Audit log" });
  await expect(audit.getByText(/^Integrity verified /)).toBeVisible();
  await expect(audit.getByText("Admin · Authentication · Succeeded", {
    exact: true,
  }).first())
    .toBeVisible();
  await expect(audit).not.toContainText("playwright-admin");
  await expect(audit).not.toContainText("Playwright123456");
  await expectNoSeriousAccessibilityViolations(page);
});
