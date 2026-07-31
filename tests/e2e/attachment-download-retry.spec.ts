import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

const attachmentHref =
  "/api/v1/mail/messages/msg-roadmap/attachments/attachment-roadmap";
const attachmentUrl = `**${attachmentHref}`;
const expectedBytes = Buffer.from(
  "Veda Mail deterministic attachment retry fixture.\n",
  "utf8",
);
const expectedHash = createHash("sha256")
  .update(expectedBytes)
  .digest("hex");

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

test("recovers from a failed attachment download and clears the stale alert", async ({
  page,
}) => {
  let attempts = 0;
  await page.route(attachmentUrl, async (route) => {
    expect(route.request().method()).toBe("GET");
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        body: JSON.stringify({
          error: {
            code: "ATTACHMENT_PROVIDER_FAILED",
            message:
              "The attachment could not be retrieved from the mail provider.",
          },
        }),
        headers: {
          ...hardenedHeaders,
          "content-type": "application/json",
          "x-veda-api-error-code": "ATTACHMENT_PROVIDER_FAILED",
        },
        status: 502,
      });
      return;
    }
    await route.fulfill({
      body: expectedBytes,
      headers: {
        ...hardenedHeaders,
        "content-disposition":
          "attachment; filename=\"Q3-roadmap.pdf\"; " +
          "filename*=UTF-8''Q3-roadmap.pdf",
        "content-length": String(expectedBytes.byteLength),
        "content-type": "application/octet-stream",
      },
      status: 200,
    });
  });

  await page
    .getByRole("button", { name: "Open Revised product roadmap · Q3" })
    .click();
  const reader = page.getByRole("article");
  const downloadButton = reader.getByRole("button", {
    name: "Download Q3-roadmap.pdf",
  });

  const failedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(attachmentHref) && response.status() === 502,
  );
  await downloadButton.click();
  await failedResponse;

  const alert = reader.getByRole("alert");
  await expect(alert).toHaveText(
    "The attachment could not be retrieved from the mail provider.",
  );
  await expect(downloadButton).toBeEnabled();
  expect(attempts).toBe(1);

  const successfulResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(attachmentHref) && response.status() === 200,
  );
  const downloadEvent = page.waitForEvent("download");
  await downloadButton.click();
  const [response, download] = await Promise.all([
    successfulResponse,
    downloadEvent,
  ]);

  expect(response.headers()).toMatchObject(hardenedHeaders);
  expect(response.headers()["content-type"]).toBe("application/octet-stream");
  expect(download.suggestedFilename()).toBe("Q3-roadmap.pdf");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const received = await readFile(downloadPath ?? "");
  expect(received).toEqual(expectedBytes);
  expect(createHash("sha256").update(received).digest("hex")).toBe(expectedHash);
  expect(attempts).toBe(2);
  await expect(alert).toHaveCount(0);
});
