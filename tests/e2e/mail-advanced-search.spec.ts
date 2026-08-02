import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("canonicalizes, shares, edits, and validates advanced search", async ({
  page,
}) => {
  const baselineResponse = await page.request.get("/api/v1/mail/workspace");
  expect(baselineResponse.ok()).toBe(true);
  const baseline = await baselineResponse.json() as {
    data: {
      mailboxes: readonly { id: string; name: string; role: string }[];
      selectedMailboxId?: string;
    };
  };
  const sent = baseline.data.mailboxes.find((mailbox) => mailbox.role === "sent");
  expect(sent).toBeTruthy();
  const searches: string[] = [];
  await page.route("**/api/v1/mail/workspace**", async (route) => {
    const search = new URL(route.request().url()).searchParams.get("search");
    if (search) searches.push(search);
    const envelope = structuredClone(baseline);
    if (search?.includes("in:sent") && sent) {
      envelope.data.selectedMailboxId = sent.id;
    }
    await route.fulfill({ json: envelope, status: 200 });
  });
  await page.reload();

  const searchbox = page.getByRole("searchbox", { name: "Search mail" });
  await searchbox.fill('from:"Ada Lovelace" larger:1K');
  await searchbox.press("Enter");

  await expect.poll(() => searches.at(-1)).toBe(
    'from:"Ada Lovelace" larger:1024',
  );
  await expect(page.getByRole("button", {
    name: 'Remove search filter from:"Ada Lovelace"',
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Remove search filter larger:1024",
  })).toBeVisible();
  expect(decodeURIComponent(new URL(page.url()).hash)).toContain(
    'search=from:"Ada+Lovelace"+larger:1024',
  );
  await expect(page.locator(
    '#mail-search-suggestions option[value="has:attachment"]',
  )).toHaveCount(1);
  await expect(page.locator(
    '#mail-search-suggestions option[value=\'from:"Ada Lovelace" larger:1024\']',
  )).toHaveCount(1);

  await page.getByRole("button", {
    name: 'Remove search filter from:"Ada Lovelace"',
  }).click();
  await expect.poll(() => searches.at(-1)).toBe("larger:1024");
  await expect(searchbox).toHaveValue("larger:1024");

  const validRequestCount = searches.length;
  await searchbox.fill("after:2026-99-99");
  await searchbox.press("Enter");
  await expect(page.locator("#mail-search-error")).toContainText("invalid date");
  expect(searches).toHaveLength(validRequestCount);

  searches.length = 0;
  await page.reload();
  await expect.poll(() => searches.at(-1)).toBe("larger:1024");
  await expect(searchbox).toHaveValue("larger:1024");

  await searchbox.fill("in:sent is:starred");
  await searchbox.press("Enter");
  await expect.poll(() => searches.at(-1)).toBe("in:sent is:starred");
  await expect(page.getByRole("heading", { name: "Sent" })).toBeVisible();
});
