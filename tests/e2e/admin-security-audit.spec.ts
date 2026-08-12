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

  const original = await page.request.get("/api/v1/admin/retention");
  expect(original.ok()).toBe(true);
  const originalPolicy = (await original.json()) as { data: { policy: {
    securityAuditMaxAgeDays: number; securityAuditMaxEntries: number;
  } } };
  try {
    await audit.getByLabel("Maximum age (days)").fill("180");
    await audit.getByLabel("Maximum records").fill("5000");
    const saved = page.waitForResponse((candidate) =>
      candidate.url().endsWith("/api/v1/admin/retention") &&
      candidate.request().method() === "PUT");
    await audit.getByRole("button", { name: "Save retention" }).click();
    expect((await saved).ok()).toBe(true);
    await expect(audit.getByRole("status")).toContainText("Data-retention policy saved.");
    await page.reload(); await page.getByRole("button", { name: "Audit log" }).click();
    await expect(page.getByLabel("Maximum age (days)")).toHaveValue("180");
    await expect(page.getByLabel("Maximum records")).toHaveValue("5000");
  } finally {
    const restored = await page.request.put("/api/v1/admin/retention", {
      data: originalPolicy.data.policy,
      headers: { origin: "http://127.0.0.1:3101" },
    });
    expect(restored.ok()).toBe(true);
  }

  await page.getByRole("button", { name: "Security", exact: true }).click();
  const sessions = page.getByRole("region", { name: "Active sessions" });
  await expect(sessions.getByText("This administrator session")).toBeVisible();
  await expect(sessions.getByRole("button", {
    name: "Revoke this administrator session",
  })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});
