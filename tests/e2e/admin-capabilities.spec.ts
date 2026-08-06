import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  installApplication,
} from "./support/mail-fixture";

test.beforeEach(async ({ request }) => {
  await installApplication(request);
});

test("persists and explains an organization capability restriction", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await page.getByLabel("Administrator username").fill("playwright-admin");
  await page.getByLabel("Administrator password").fill("Playwright123456");
  await page.getByRole("button", { name: "Open administration" }).click();
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
  await page.getByRole("button", { name: "Capabilities" }).click();

  const profilePolicy = page.getByRole("checkbox", {
    name: /^Member profile editing/,
  });
  const profileRow = page.getByRole("row").filter({
    hasText: "Member profile editing",
  });
  await expect(profilePolicy).toBeChecked();
  await expect(profileRow).toContainText("Available");

  try {
    await profilePolicy.uncheck();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/admin/capabilities") &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save policy" }).click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByRole("status")).toContainText(
      "Organization feature policy saved.",
    );
    await expect(profileRow).toContainText("Disabled");
    await expect(profileRow).toContainText("Unavailable");

    await page.reload();
    await page.getByRole("button", { name: "Capabilities" }).click();
    await expect(
      page.getByRole("checkbox", { name: /^Member profile editing/ }),
    ).not.toBeChecked();
    await expectNoSeriousAccessibilityViolations(page);
  } finally {
    const restored = await page.request.put("/api/v1/admin/capabilities", {
      data: {
        memberPasswordChange: true,
        memberProfileEditing: true,
        memberTwoFactorEnrollment: true,
      },
      headers: { origin: "http://127.0.0.1:3101" },
    });
    expect(restored.ok()).toBe(true);
  }
});

test("persists bounded organization message and file rules", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Administrator username").fill("playwright-admin");
  await page.getByLabel("Administrator password").fill("Playwright123456");
  await page.getByRole("button", { name: "Open administration" }).click();
  await page.getByRole("button", { name: "Capabilities" }).click();
  await expect(page.getByRole("heading", {
    name: "Message & attachment policy",
  })).toBeVisible();

  try {
    await page.getByLabel("Maximum attachments per message").fill("3");
    await page.getByLabel("Blocked extensions").fill("exe, js");
    const saved = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/admin/mail-policy") &&
      response.request().method() === "PUT");
    await page.getByRole("button", { name: "Save mail policy" }).click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByRole("status")).toContainText(
      "Mail content policy saved.",
    );

    await page.reload();
    await page.getByRole("button", { name: "Capabilities" }).click();
    await expect(page.getByLabel("Maximum attachments per message")).toHaveValue("3");
    await expect(page.getByLabel("Blocked extensions")).toHaveValue("exe, js");
    await expectNoSeriousAccessibilityViolations(page);
  } finally {
    const restored = await page.request.put("/api/v1/admin/mail-policy", {
      data: {
        allowedExtensions: [], allowedMimeTypes: [], blockedExtensions: [],
        blockedMimeTypes: [], maxAttachmentBytes: 18 * 1024 * 1024,
        maxAttachmentsPerMessage: 10, maxMessageBytes: 32 * 1024 * 1024,
      },
      headers: { origin: "http://127.0.0.1:3101" },
    });
    expect(restored.ok()).toBe(true);
  }
});
