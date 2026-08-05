import { expect, test } from "@playwright/test";

import {
  expectNoWcagAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const expectNoPageHorizontalOverflow = async (
  page: Parameters<typeof expectNoWcagAccessibilityViolations>[0],
) => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
};

test("reflows mailbox and compose at the WCAG 320 CSS-pixel boundary", async ({
  page,
}) => {
  await page.setViewportSize({ height: 720, width: 320 });
  await expectNoPageHorizontalOverflow(page);
  await expectNoWcagAccessibilityViolations(page);

  await page.getByRole("button", {
    exact: true,
    name: "Compose a new message",
  }).click();
  const composer = page.getByRole("dialog", { name: "Compose message" });
  await expect(composer).toBeVisible();
  await expect(composer.getByRole("combobox", { name: "To" })).toBeFocused();
  await expectNoPageHorizontalOverflow(page);
  await expectNoWcagAccessibilityViolations(page);
});

test("keeps keyboard entry and focus visible without pointer input", async ({
  page,
}) => {
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to message list" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-message-list-heading]")).toBeFocused();
  const focusIndicator = await page.locator("[data-message-list-heading]")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { boxShadow: style.boxShadow, outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth };
    });
  expect(focusIndicator.outlineStyle !== "none" ||
    focusIndicator.outlineWidth !== "0px" ||
    focusIndicator.boxShadow !== "none").toBe(true);
});

test("keeps the primary keyboard path visibly focused", async ({ page }) => {
  const failures: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        label: element.getAttribute("aria-label") || element.innerText ||
          element.getAttribute("placeholder") || element.tagName,
        hasIndicator: element.matches(":focus-visible") &&
          (style.outlineStyle !== "none" || style.outlineWidth !== "0px" ||
            style.boxShadow !== "none"),
        visible: rect.height > 0 && rect.width > 0,
      };
    });
    if (!focus?.visible || !focus.hasIndicator) {
      failures.push(focus?.label ?? "No active element");
    }
  }
  expect(failures).toEqual([]);
});

test("keeps non-inline mailbox controls at least 24 CSS pixels", async ({
  page,
}) => {
  const undersized = await page.evaluate(() =>
    [...document.querySelectorAll("button, input, select, textarea")]
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" ||
          rect.width === 0 || rect.height === 0 ||
          element.closest("[hidden], [inert]")) return [];
        return rect.width < 24 || rect.height < 24
          ? [{ height: rect.height, html: element.outerHTML.slice(0, 180),
            width: rect.width }]
          : [];
      }).slice(0, 20));
  expect(undersized).toEqual([]);
});

test("honors reduced motion across the rendered mailbox", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByRole("button", { name: "New message" })).toBeEnabled();
  const movingElements = await page.evaluate(() =>
    [...document.querySelectorAll("*")].flatMap((element) => {
      const style = getComputedStyle(element);
      const durations = `${style.animationDuration},${style.transitionDuration}`
        .split(",").map((value) => value.trim());
      return durations.some((value) => value.endsWith("s") &&
        Number.parseFloat(value) > 0.001) ? [element.tagName] : [];
    }).slice(0, 10));
  expect(movingElements).toEqual([]);
});

test("keeps reader and account settings free of WCAG violations", async ({
  page,
}) => {
  await page.setViewportSize({ height: 720, width: 320 });
  await page.getByRole("button", {
    name: "Open Revised product roadmap · Q3",
  }).click();
  await expect(page.getByRole("heading", {
    name: "Revised product roadmap · Q3",
  })).toBeFocused();
  await expectNoPageHorizontalOverflow(page);
  await expectNoWcagAccessibilityViolations(page);

  await page.getByRole("button", {
    name: "Open account settings for member@example.com",
  }).click();
  const settings = page.getByRole("dialog", { name: "Account settings" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Provider capabilities" }))
    .toBeVisible();
  await expectNoPageHorizontalOverflow(page);
  await expectNoWcagAccessibilityViolations(page);
});

test("retains keyboard focus in forced-colors mode", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.reload();
  await expect(page.getByRole("button", { name: "New message", exact: true }))
    .toBeEnabled();
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to message list" });
  await expect(skipLink).toBeFocused();
  const indicator = await skipLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(indicator.outlineStyle).not.toBe("none");
  expect(indicator.outlineWidth).not.toBe("0px");
});

test("keeps the signed-out entry point reflowable and screen-reader clean", async ({
  context,
  page,
}) => {
  await context.clearCookies();
  await page.setViewportSize({ height: 720, width: 320 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to your mail" }))
    .toBeVisible();
  await expectNoPageHorizontalOverflow(page);
  await expectNoWcagAccessibilityViolations(page);
});
