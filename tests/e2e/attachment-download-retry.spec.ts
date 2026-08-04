import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

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

test("shows a threat verdict without claiming the attachment is safe", async ({
  page,
}) => {
  await page.route(attachmentUrl, (route) => route.fulfill({
    body: JSON.stringify({
      error: {
        code: "ATTACHMENT_THREAT_DETECTED",
        message: "Threat detected. This attachment was blocked.",
      },
    }),
    contentType: "application/json",
    status: 422,
  }));
  await page
    .getByRole("button", { name: "Open Revised product roadmap · Q3" })
    .click();
  const reader = page.getByRole("article");
  let downloads = 0;
  page.on("download", () => { downloads += 1; });

  await reader.getByRole("button", { name: "Download Q3-roadmap.pdf" }).click();

  await expect(reader.getByRole("alert")).toHaveText(
    "Threat detected. This attachment was blocked.",
  );
  await expect(reader.getByText(/safe/iu)).toHaveCount(0);
  expect(downloads).toBe(0);
});

test("announces scanning and recovers from scanner unavailability on mobile", async ({
  page,
}) => {
  const longName = `${"सुरक्षारिपोर्ट".repeat(4)}.pdf`;
  await page.setViewportSize({ height: 844, width: 390 });
  await page.route("**/api/v1/mail/messages/msg-roadmap", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as {
      data: { attachments: Array<{ name: string }> };
    };
    if (payload.data.attachments[0]) payload.data.attachments[0].name = longName;
    await route.fulfill({ json: payload, response });
  });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let attempts = 0;
  await page.route(attachmentUrl, async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await firstGate;
      await route.fulfill({
        body: JSON.stringify({
          error: {
            code: "ATTACHMENT_SCANNER_UNAVAILABLE",
            message: "The attachment scanner is unavailable. Try again.",
          },
        }),
        contentType: "application/json",
        status: 503,
      });
      return;
    }
    await route.fulfill({
      body: expectedBytes,
      headers: {
        ...hardenedHeaders,
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
    name: `Download ${longName}`,
  });
  await downloadButton.focus();
  await page.keyboard.press("Enter");

  await expect(downloadButton).toHaveAttribute("aria-busy", "true");
  const feedbackId = await downloadButton.getAttribute("aria-describedby");
  expect(feedbackId).toBe("attachment-attachment-roadmap-download-feedback");
  await expect(reader.locator(`#${feedbackId}`)).toHaveText(
    `Scanning ${longName} before download…`,
  );
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);
  releaseFirst();
  await expect(reader.getByRole("alert")).toHaveText(
    "The attachment scanner is unavailable. Try again.",
  );
  await expect(downloadButton).toBeEnabled();
  await expect(downloadButton).toBeFocused();

  const downloadEvent = page.waitForEvent("download");
  await downloadButton.click();
  await downloadEvent;
  await expect(reader.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
});
