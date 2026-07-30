import { expect, test, type Page } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  sendComposer,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const firstUploadId = "a".repeat(32);
const secondUploadId = "b".repeat(32);
const thirdUploadId = "c".repeat(32);
const sourceAttachments = [
  {
    id: "forward-source-one",
    mimeType: "application/pdf",
    name: "roadmap.pdf",
    size: 51,
  },
  {
    id: "forward-source-two",
    mimeType: "text/plain",
    name: "notes.txt",
    size: 19,
  },
  {
    id: "forward-source-three",
    mimeType: "image/png",
    name: "diagram.png",
    size: 27,
  },
];

const openForwardSource = async (page: Page) => {
  await page.route(
    "**/api/v1/mail/messages/msg-roadmap",
    async (requestRoute) => {
      const response = await requestRoute.fetch();
      const payload = (await response.json()) as {
        data: { attachments: unknown[] };
      };
      payload.data.attachments = sourceAttachments;
      await requestRoute.fulfill({ json: payload, response });
    },
  );
  await page
    .getByRole("button", { name: "Open Revised product roadmap · Q3" })
    .click();
  await page.getByRole("button", { name: "Forward" }).click();
  return page.getByRole("dialog", { name: "Compose message" });
};

const attachmentIdFrom = (url: string): string => {
  const segments = new URL(url).pathname.split("/");
  return decodeURIComponent(segments.at(-2) ?? "");
};

test("imports sequentially, retries partial failure, and reuses clean IDs", async ({
  page,
}) => {
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let releaseThird: () => void = () => undefined;
  const thirdGate = new Promise<void>((resolve) => {
    releaseThird = resolve;
  });
  const imports: { attachmentId: string; body: Record<string, unknown> }[] = [];
  const attempts = new Map<string, number>();
  let firstCompleted = false;
  let importsOverlapped = false;
  let thirdCompleted = false;
  let retryOverlapped = false;
  await page.route(
    "**/api/v1/mail/messages/*/attachments/*/imports",
    async (requestRoute) => {
      const attachmentId = attachmentIdFrom(requestRoute.request().url());
      const body = requestRoute.request().postDataJSON() as Record<
        string,
        unknown
      >;
      imports.push({ attachmentId, body });
      if (imports.length > 1 && !firstCompleted) importsOverlapped = true;
      const attempt = (attempts.get(attachmentId) ?? 0) + 1;
      attempts.set(attachmentId, attempt);
      if (
        attachmentId === sourceAttachments[1]?.id &&
        attempt > 1 &&
        !thirdCompleted
      ) {
        retryOverlapped = true;
      }
      if (attachmentId === sourceAttachments[0]?.id) await firstGate;
      if (attachmentId === sourceAttachments[2]?.id) await thirdGate;
      if (attachmentId === sourceAttachments[1]?.id && attempt === 1) {
        await requestRoute.fulfill({
          json: {
            error: {
              message:
                "This original attachment exceeds the remaining message limit.",
            },
          },
          status: 413,
        });
        return;
      }
      const source = sourceAttachments.find(({ id }) => id === attachmentId);
      if (attachmentId === sourceAttachments[0]?.id) firstCompleted = true;
      if (attachmentId === sourceAttachments[2]?.id) thirdCompleted = true;
      const uploadId =
        attachmentId === sourceAttachments[0]?.id
          ? firstUploadId
          : attachmentId === sourceAttachments[1]?.id
            ? secondUploadId
            : thirdUploadId;
      await requestRoute.fulfill({
        json: {
          data: {
            expiresAt: "2099-01-01T00:00:00.000Z",
            id: uploadId,
            mimeType: source?.mimeType,
            name: source?.name,
            size: source?.size,
          },
        },
        status: 201,
      });
    },
  );

  const dialog = await openForwardSource(page);
  await expect(dialog.getByText("Copying and scanning…")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /^Send$/ })).toBeDisabled();
  await expect.poll(() => imports.length).toBe(1);
  expect(Object.keys(imports[0]?.body ?? {})).toEqual(["draftId"]);

  releaseFirst();
  await expect.poll(() => imports.length).toBe(3);
  expect(importsOverlapped).toBe(false);
  await expect(
    dialog.getByText(
      "This original attachment exceeds the remaining message limit.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Retry copying notes.txt" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Send$/ })).toBeDisabled();
  await expectNoSeriousAccessibilityViolations(page);

  await dialog
    .getByRole("button", { name: "Retry copying notes.txt" })
    .click();
  releaseThird();
  await expect.poll(() => imports.length).toBe(4);
  expect(retryOverlapped).toBe(false);
  await expect(dialog.getByText("application/pdf")).toBeVisible();
  await expect(dialog.getByText("text/plain")).toBeVisible();
  const draftIds = imports.map(({ body }) => body["draftId"]);
  expect(new Set(draftIds).size).toBe(1);
  expect(
    imports.every(({ body }) => Object.keys(body).join() === "draftId"),
  ).toBe(true);

  const sends: Record<string, unknown>[] = [];
  await page.route("**/api/v1/mail/send", async (requestRoute) => {
    sends.push(requestRoute.request().postDataJSON() as Record<string, unknown>);
    if (sends.length === 1) {
      await requestRoute.fulfill({
        json: {
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message: "Mail provider is temporarily unavailable.",
          },
        },
        status: 502,
      });
      return;
    }
    await requestRoute.fulfill({
      json: {
        data: {
          id: "forwarded-message",
          submittedAt: "2026-07-30T00:00:00.000Z",
        },
      },
      status: 201,
    });
  });
  await dialog
    .getByRole("textbox", { exact: true, name: "To" })
    .fill("recipient@example.com");
  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Mail provider is temporarily unavailable.",
  );
  await expect(dialog.getByText("application/pdf")).toBeVisible();
  await sendComposer(page);

  expect(sends).toHaveLength(2);
  expect(sends[0]?.["attachmentIds"]).toEqual([
    firstUploadId,
    secondUploadId,
    thirdUploadId,
  ]);
  expect(sends[1]?.["attachmentIds"]).toEqual(
    sends[0]?.["attachmentIds"],
  );
  expect(sends[1]?.["draftId"]).toBe(draftIds[0]);
  await expectNoSeriousAccessibilityViolations(page);
});
