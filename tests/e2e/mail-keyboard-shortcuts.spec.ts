import { expect, test, type Page } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  mailSessionScopeHeaders,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const saveShortcuts = async (page: Page, keyboardShortcuts: boolean) => {
  const scope = await mailSessionScopeHeaders(page);
  const response = await page.request.patch("/api/v1/mail/preferences", {
    data: {
      confirmBeforeSend: false,
      density: "comfortable",
      keyboardShortcuts,
      showPreview: true,
      sort: "newest",
      undoSendSeconds: 0,
    },
    headers: { ...scope, origin: "http://127.0.0.1:3101" },
  });
  expect(response.ok()).toBe(true);
};

test.beforeEach(async ({ page }) => {
  await saveShortcuts(page, false);
  await page.reload();
});

test.afterEach(async ({ page }) => {
  await saveShortcuts(page, false);
});

test("offers a trapped, truthful, accessible shortcut guide", async ({ page }) => {
  const trigger = page.getByRole("button", {
    name: "Open keyboard shortcut guide",
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  const close = dialog.getByRole("button", {
    name: "Close keyboard shortcut guide",
  });

  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Shortcuts are off. Enable them in Mailbox preferences.",
  );
  await expect(close).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await expectNoSeriousAccessibilityViolations(page);
  await close.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("routes enabled shortcuts and suspends them in editors and dialogs", async ({
  page,
}) => {
  await saveShortcuts(page, true);
  await page.reload();
  const search = page.getByRole("searchbox", { name: "Search mail" });

  await expect(search).toHaveAttribute("aria-keyshortcuts", "/");
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await page.keyboard.type("c");
  await expect(search).toHaveValue("c");
  await expect(page.getByRole("dialog", { name: "Compose message" }))
    .toHaveCount(0);
  await search.fill("");
  await page.getByRole("button", { name: "Refresh mail" }).focus();
  await page.keyboard.press("c");
  const composer = page.getByRole("dialog", { name: "Compose message" });
  await expect(composer).toBeVisible();
  await composer.getByRole("button", { name: "Close composer" }).click();
  await expect(composer).toBeHidden();

  const message = page.getByRole("button", {
    name: "Open Revised product roadmap · Q3",
  });
  await message.click();
  const heading = page.getByRole("heading", {
    name: "Revised product roadmap · Q3",
  });
  await expect(heading).toBeFocused();

  const addStar = page.getByRole("button", { name: "Add star" });
  const initiallyUnstarred = await addStar.count() > 0;
  await page.keyboard.press("s");
  await expect(page.getByText("Message star changed.")).toBeVisible();
  const toggledStar = page.getByRole("button", {
    name: initiallyUnstarred ? "Remove star" : "Add star",
  });
  await expect(toggledStar).toBeVisible();
  await expect(toggledStar).toBeEnabled();

  const markRead = page.getByRole("button", { name: "Mark as read" });
  const initiallyUnread = await markRead.count() > 0;
  await page.keyboard.press("u");
  const readToggle = page.getByRole("button", {
    name: initiallyUnread ? "Mark as unread" : "Mark as read",
  });
  await expect(readToggle).toBeVisible();
  await expect(readToggle).toBeEnabled();
  await heading.focus();
  await expect(heading).toBeFocused();

  await page.keyboard.press("r");
  const reply = page.getByRole("dialog", { name: "Compose message" });
  await expect(reply.getByRole("textbox", { name: "Subject" }))
    .toHaveValue("Re: Revised product roadmap · Q3");
  await reply.getByRole("button", { name: "Close composer" }).click();
  await reply.getByRole("alertdialog")
    .getByRole("button", { name: "Close without saving" }).click();
  await expect(reply).toBeHidden();

  await page.getByRole("button", { name: "Open keyboard shortcut guide" })
    .click();
  const guide = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(guide).toContainText("Shortcuts are enabled for this account.");
  await page.keyboard.press("e");
  await expect(page.locator("[data-reader-heading]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(message).toBeFocused();

  await page.keyboard.press("j");
  await expect(page.locator("[data-reader-heading]")).toBeFocused();
  let archiveBody: Record<string, unknown> | null = null;
  await page.route("**/api/v1/mail/messages/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    archiveBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { data: { updated: true } }, status: 200 });
  });
  await page.keyboard.press("e");
  await expect.poll(() => archiveBody).toMatchObject({ type: "archive" });
  await expectNoSeriousAccessibilityViolations(page);
});
