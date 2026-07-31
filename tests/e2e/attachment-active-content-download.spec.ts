import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

const attachmentHref =
  "/api/v1/mail/messages/msg-roadmap/attachments/attachment-roadmap";
const expectedFileName = "Q3-roadmap.pdf";
const executionMarker = "__vedaAttachmentActiveContentExecuted";
const hardenedHeaders = {
  "accept-ranges": "none",
  "cache-control": "private, no-store, no-transform, max-age=0",
  "content-security-policy": "sandbox; default-src 'none'",
  "cross-origin-resource-policy": "same-origin",
  expires: "0",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-download-options": "noopen",
} as const;

const activeContentCases = [
  {
    bytes: Buffer.from(
      [
        "<!doctype html><meta charset=utf-8>",
        `<script>window.${executionMarker}=true;`,
        `if(window.opener)window.opener.${executionMarker}=true;`,
        "alert('hostile-html-executed');",
        "top.location='https://attacker.invalid/html-executed';</script>",
        `<img src=x onerror="window.${executionMarker}=true">`,
      ].join(""),
      "utf8",
    ),
    label: "HTML",
  },
  {
    bytes: Buffer.from(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" ',
        `onload="window.${executionMarker}=true;`,
        "alert('hostile-svg-executed');",
        `top.location='https://attacker.invalid/svg-executed'">`,
        `<script>window.${executionMarker}=true;</script>`,
        "<text>Hostile SVG attachment fixture</text></svg>",
      ].join(""),
      "utf8",
    ),
    label: "SVG",
  },
] as const;

for (const activeContent of activeContentCases) {
  test(`downloads hostile ${activeContent.label} bytes without executing them`, async ({
    page,
  }) => {
    let attempts = 0;
    await page.route(`**${attachmentHref}`, async (route) => {
      expect(route.request().method()).toBe("GET");
      attempts += 1;
      await route.fulfill({
        body: activeContent.bytes,
        headers: {
          ...hardenedHeaders,
          "content-disposition":
            `attachment; filename="${expectedFileName}"; ` +
            `filename*=UTF-8''${expectedFileName}`,
          "content-length": String(activeContent.bytes.byteLength),
          "content-type": "application/octet-stream",
        },
        status: 200,
      });
    });

    await page
      .getByRole("button", { name: "Open Revised product roadmap · Q3" })
      .click();
    const originalUrl = page.url();
    await page.evaluate((marker) => {
      Reflect.set(window, marker, false);
    }, executionMarker);
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });

    const responseEvent = page.waitForResponse(
      (response) =>
        response.url().endsWith(attachmentHref) && response.status() === 200,
    );
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: `Download ${expectedFileName}` })
      .click();
    const [response, download] = await Promise.all([
      responseEvent,
      downloadEvent,
    ]);

    expect(response.headers()).toMatchObject({
      ...hardenedHeaders,
      "content-type": "application/octet-stream",
    });
    expect(response.headers()["content-disposition"]).toContain(
      `filename="${expectedFileName}"`,
    );
    expect(download.suggestedFilename()).toBe(expectedFileName);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const received = await readFile(downloadPath ?? "");
    expect(received).toEqual(activeContent.bytes);
    expect(createHash("sha256").update(received).digest("hex")).toBe(
      createHash("sha256").update(activeContent.bytes).digest("hex"),
    );

    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(page.url()).toBe(originalUrl);
    expect(dialogs).toEqual([]);
    expect(
      await page.evaluate((marker) => Reflect.get(window, marker), executionMarker),
    ).toBe(false);
    expect(attempts).toBe(1);
  });
}
