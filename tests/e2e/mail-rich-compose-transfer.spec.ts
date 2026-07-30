import { expect, test, type Page } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

const openComposer = async (page: Page) => {
  await page.getByRole("button", { name: "New message" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await dialog
    .getByRole("textbox", { exact: true, name: "To" })
    .fill("recipient@example.com");
  const body = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  return { body, dialog };
};

const dropExternalTextAtPointer = async (
  body: ReturnType<Page["getByRole"]>,
) => {
  await body.evaluate((element) => {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
    );
    let text = walker.nextNode();
    while (text && !text.textContent?.includes("Alpha Omega")) {
      text = walker.nextNode();
    }
    if (!text) throw new Error("Expected a rich-editor text node.");
    const caret = document.createRange();
    caret.setStart(text, 6);
    caret.collapse(true);
    const rect = caret.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.setData("text/html", "<b>Beta </b>");
    transfer.setData("text/plain", "Beta ");
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left,
        clientY: rect.top + rect.height / 2,
        dataTransfer: transfer,
      }),
    );
  });
};

const moveInternalText = async (body: ReturnType<Page["getByRole"]>) => {
  await body.evaluate(async (element) => {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
    );
    const textNodes: Text[] = [];
    let candidate = walker.nextNode();
    while (candidate) {
      if (candidate instanceof Text) textNodes.push(candidate);
      candidate = walker.nextNode();
    }
    const source = textNodes.find((node) => node.data.includes("Beta "));
    const destination = textNodes.find((node) => node.data.includes("Alpha "));
    if (!source || !destination) {
      throw new Error("Expected separate source and destination text nodes.");
    }
    const sourceStart = source.data.indexOf("Beta ");
    const sourceRange = document.createRange();
    sourceRange.setStart(source, sourceStart);
    sourceRange.setEnd(source, sourceStart + "Beta ".length);
    const domSelection = window.getSelection();
    domSelection?.removeAllRanges();
    domSelection?.addRange(sourceRange);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const destinationRange = document.createRange();
    destinationRange.setStart(destination, 0);
    destinationRange.collapse(true);
    const destinationRect = destinationRange.getBoundingClientRect();
    const transfer = new DataTransfer();
    element.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: destinationRect.left,
        clientY: destinationRect.top + destinationRect.height / 2,
        dataTransfer: transfer,
      }),
    );
  });
};

const dropMixedFilePayload = async (
  body: ReturnType<Page["getByRole"]>,
) => {
  await body.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["private"], "private.txt", { type: "text/plain" }),
    );
    transfer.setData("text/plain", "C:\\Users\\alice\\private.txt");
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: rect.right - 8,
        clientY: rect.top + 24,
        dataTransfer: transfer,
      }),
    );
  });
};

const pasteMixedFilePayload = async (
  body: ReturnType<Page["getByRole"]>,
) => {
  await body.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["private"], "clipboard.txt", { type: "text/plain" }),
    );
    transfer.setData("text/plain", "C:\\Users\\alice\\clipboard.txt");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  });
};

test("moves plain transfers at their pointer and blocks every file payload", async ({
  page,
}) => {
  let uploadRequests = 0;
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/mail/send", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      body: JSON.stringify({
        data: {
          deliveryStatus: "accepted",
          id: "transfer-accepted",
          rejectedRecipients: [],
          submittedAt: "2026-07-30T00:00:00.000Z",
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/mail/attachments"
    ) {
      uploadRequests += 1;
    }
  });
  const { body, dialog } = await openComposer(page);
  await body.fill("Alpha Omega");
  await body.press("End");

  await dropExternalTextAtPointer(body);
  await expect(body).toHaveText("Alpha Beta Omega");
  await expect(body.locator("b")).toHaveCount(0);

  await moveInternalText(body);
  await expect(body).toHaveText("Beta Alpha Omega");

  await dropMixedFilePayload(body);
  await pasteMixedFilePayload(body);
  await expect(body).toHaveText("Beta Alpha Omega");
  await expect(
    dialog
      .getByRole("status")
      .filter({ hasText: "Files cannot be pasted or dropped" }),
  ).toBeVisible();

  await dialog
    .getByRole("button", { name: "Switch to plain text" })
    .click();
  const plainBody = dialog.getByRole("textbox", {
    exact: true,
    name: "Message body",
  });
  await expect(plainBody).toHaveValue("Beta Alpha Omega");
  await dropMixedFilePayload(plainBody);
  await pasteMixedFilePayload(plainBody);
  await expect(plainBody).toHaveValue("Beta Alpha Omega");
  await expect(
    dialog
      .getByRole("status")
      .filter({ hasText: "Files cannot be pasted or dropped" }),
  ).toBeVisible();
  expect(uploadRequests).toBe(0);

  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await expect(dialog).toBeHidden();
  expect(submitted).toMatchObject({ body: "Beta Alpha Omega" });
  expect(JSON.stringify(submitted)).not.toContain("C:\\Users\\alice");
  expect(submitted).not.toHaveProperty("htmlBody");
});
