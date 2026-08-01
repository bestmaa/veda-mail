import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

import { parseStoreZip } from "../support/store-zip";
import {
  expectNoSeriousAccessibilityViolations,
  mailSessionScopeHeaders,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const expected = new Map<string, Uint8Array>([
  [
    "_.._report.txt",
    new TextEncoder().encode("first deterministic attachment\n"),
  ],
  ["_.._REPORT (2).txt", Uint8Array.of(0, 255, 1, 254, 2, 253)],
  ["नमस्ते.txt", new Uint8Array()],
]);

const hash = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

test("downloads every attachment as one safe byte-identical ZIP", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page
    .getByRole("button", {
      name: "Open Archive download security fixtures",
    })
    .click();
  const reader = page.getByRole("article");
  const downloadAll = reader.getByRole("button", {
    name: "Download all 3 attachments as a ZIP file",
  });

  await expect(downloadAll).toBeVisible();
  await expect(
    reader.getByRole("button", { name: /^Download (?!all\b)/u }),
  ).toHaveCount(3);
  const box = await downloadAll.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);

  await downloadAll.focus();
  await expect(downloadAll).toBeFocused();
  const event = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const archiveDownload = await event;

  expect(archiveDownload.suggestedFilename()).toBe("attachments.zip");
  await expect(downloadAll).toBeFocused();
  const path = await archiveDownload.path();
  expect(path).not.toBeNull();
  const archive = await readFile(path ?? "");
  const entries = parseStoreZip(archive);
  const independentlyExtracted = unzipSync(archive);
  expect(entries.map(({ name }) => name)).toEqual([...expected.keys()]);
  expect(Object.keys(independentlyExtracted)).toEqual([...expected.keys()]);
  for (const entry of entries) {
    expect(entry.method).toBe(0);
    expect(entry.name).not.toMatch(/[\\/]/u);
    expect(hash(entry.bytes)).toBe(
      hash(expected.get(entry.name) ?? new Uint8Array()),
    );
  }
  const href = "/api/v1/mail/messages/msg-archive-fixtures/attachments/archive";
  const origin = new URL(page.url()).origin;
  const scopeHeaders = await mailSessionScopeHeaders(page);
  const ticketResponse = await page.request.post(href, {
    headers: { origin, ...scopeHeaders },
  });
  expect(ticketResponse.status()).toBe(201);
  const ticketPayload = (await ticketResponse.json()) as {
    readonly data: { readonly ticket: string };
  };
  const ticketHref = `${href}?ticket=${encodeURIComponent(
    ticketPayload.data.ticket,
  )}`;
  expect(ticketHref).not.toContain("sessionScope");
  const authenticated = await page.request.get(ticketHref, {
    headers: { origin },
  });
  expect(authenticated.status()).toBe(200);
  expect(authenticated.headers()["content-type"]).toBe("application/zip");
  expect(authenticated.headers()["cache-control"]).toBe(
    "private, no-store, no-transform, max-age=0",
  );
  expect(authenticated.headers()["accept-ranges"]).toBe("none");
  expect(parseStoreZip(await authenticated.body())).toHaveLength(3);
  const replay = await page.request.get(ticketHref, {
    headers: { origin },
  });
  expect(replay.status()).toBe(403);

  const unauthenticated = await request.get(
    `${href}?ticket=${"u".repeat(43)}`,
    {
      headers: { origin },
    },
  );
  expect(unauthenticated.status()).toBe(401);
  const crossOrigin = await page.request.get(href ?? "", {
    headers: { origin: "https://evil.example" },
  });
  expect(crossOrigin.status()).toBe(403);
  const ranged = await page.request.get(href ?? "", {
    headers: {
      origin,
      range: "bytes=0-10",
      ...scopeHeaders,
    },
  });
  expect(ranged.status()).toBe(416);
});

test("does not show Download all for a message without attachments", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Open Your Stalwart workspace is ready" })
    .click();

  await expect(page.getByRole("button", { name: /Download all/u })).toHaveCount(
    0,
  );
});

test("shows an actionable error when ZIP preflight fails", async ({ page }) => {
  await page.route(
    "**/api/v1/mail/messages/msg-archive-fixtures/attachments/archive",
    async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          contentType: "application/json",
          status: 413,
          body: JSON.stringify({
            error: {
              code: "ATTACHMENT_ARCHIVE_TOO_LARGE",
              message: "These attachments are too large to download together.",
            },
          }),
        });
        return;
      }
      await route.continue();
    },
  );
  await page
    .getByRole("button", {
      name: "Open Archive download security fixtures",
    })
    .click();
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });

  await page
    .getByRole("button", {
      name: "Download all 3 attachments as a ZIP file",
    })
    .click();

  await expect(
    page.getByRole("alert").filter({
      hasText: "too large to download together",
    }),
  ).toBeVisible();
  expect(downloads).toBe(0);
});

test("shows a post-preflight failure as an accessible retry state", async ({
  page,
}) => {
  await page
    .getByRole("button", {
      name: "Open Archive provider failure recovery fixture",
    })
    .click();
  const downloadAll = page.getByRole("button", {
    name: "Download all 2 attachments as a ZIP file",
  });
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await downloadAll.focus();
  await downloadAll.click();

  await expect(
    page.getByRole("alert").filter({
      hasText: "archive could not be retrieved from the provider",
    }),
  ).toBeVisible();
  await expect(downloadAll).toBeFocused();
  expect(downloads).toBe(0);
  await expect(downloadAll).toBeEnabled();
  await expect(downloadAll).toHaveAttribute(
    "aria-describedby",
    "received-attachments-archive-feedback",
  );
});
