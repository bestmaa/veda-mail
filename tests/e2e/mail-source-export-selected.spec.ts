import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("exports selected messages as a standard EML ZIP", async ({ page }) => {
  let firstId = "";
  const secondId = "message-export-second";
  await page.route("**/api/v1/mail/workspace**", async (route) => {
    const response = await route.fetch();
    const envelope = (await response.json()) as { data: { messages: { items: Array<Record<string, unknown>>; nextCursor: string | null; total: number } } };
    const first = envelope.data.messages.items[0];
    if (!first) throw new Error("The export fixture requires one message.");
    firstId = String(first["id"]);
    envelope.data.messages = { items: [first, { ...first, id: secondId, subject: "Portable export follow-up", threadId: "thread-export-second" }], nextCursor: null, total: 2 };
    await route.fulfill({ json: envelope, response });
  });
  let posted: unknown;
  await page.route("**/api/v1/mail/messages/export", async (route) => {
    posted = route.request().postDataJSON();
    const archive = zipSync({
      "message-001.eml": new TextEncoder().encode("Subject: First\r\n\r\nOne"),
      "message-002.eml": new TextEncoder().encode("Subject: Second\r\n\r\nTwo"),
    }, { level: 0 });
    await route.fulfill({ body: Buffer.from(archive), contentType: "application/zip", headers: { "content-disposition": 'attachment; filename="veda-mail-messages.zip"' }, status: 200 });
  });
  await page.reload();
  await page.getByRole("checkbox", { name: "Select Your Stalwart workspace is ready" }).check();
  await page.getByRole("checkbox", { name: "Select Portable export follow-up" }).check();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export selected messages as EML files" }).click(),
  ]);
  expect(posted).toEqual({ messageIds: [firstId, secondId] });
  expect(download.suggestedFilename()).toBe("veda-mail-messages.zip");
  const path = await download.path(); expect(path).not.toBeNull();
  const parsed = unzipSync(new Uint8Array(await readFile(path ?? "")));
  expect(Object.keys(parsed)).toEqual(["message-001.eml", "message-002.eml"]);
});
