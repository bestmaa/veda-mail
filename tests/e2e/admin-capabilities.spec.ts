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
