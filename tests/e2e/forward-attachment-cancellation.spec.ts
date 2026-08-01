import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

const sources = [
  {
    disposition: "attachment",
    id: "forward-cancel-one",
    mimeType: "application/pdf",
    name: "roadmap.pdf",
    size: 51,
  },
  {
    disposition: "attachment",
    id: "forward-cancel-two",
    mimeType: "text/plain",
    name: "notes.txt",
    size: 19,
  },
];

test("closing aborts queued imports and isolates the next draft", async ({
  page,
}) => {
  await page.route(
    "**/api/v1/mail/messages/msg-roadmap",
    async (requestRoute) => {
      const response = await requestRoute.fetch();
      const payload = (await response.json()) as {
        data: { attachments: unknown[] };
      };
      payload.data.attachments = sources;
      await requestRoute.fulfill({ json: payload, response });
    },
  );
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstHandled: () => void = () => undefined;
  const firstHandled = new Promise<void>((resolve) => {
    markFirstHandled = resolve;
  });
  const requested: string[] = [];
  await page.route(
    "**/api/v1/mail/messages/*/attachments/*/imports",
    async (requestRoute) => {
      const segments = new URL(requestRoute.request().url()).pathname.split("/");
      requested.push(decodeURIComponent(segments.at(-2) ?? ""));
      await firstGate;
      await requestRoute
        .fulfill({
          json: {
            data: {
              expiresAt: "2099-01-01T00:00:00.000Z",
              id: "a".repeat(32),
              mimeType: "application/pdf",
              name: "roadmap.pdf",
              size: 51,
            },
          },
          status: 201,
        })
        .catch(() => undefined);
      markFirstHandled();
    },
  );

  await page
    .getByRole("button", { name: "Open Revised product roadmap · Q3" })
    .click();
  await page.getByRole("button", { name: "Forward" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await expect.poll(() => requested.length).toBe(1);
  await dialog.getByRole("button", { name: "Close composer" }).click();
  const closePrompt = dialog.getByRole("alertdialog", {
    name: "Close with unsaved changes?",
  });
  await expect(closePrompt).toBeVisible();
  await closePrompt
    .getByRole("button", { name: "Close without saving" })
    .click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "New message" }).click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("list", { name: "Message attachments" }),
  ).toHaveCount(0);

  releaseFirst();
  await firstHandled;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(requested).toEqual([sources[0]?.id]);
  await expect(dialog.getByText("roadmap.pdf")).toHaveCount(0);
  await expect(dialog.getByText("notes.txt")).toHaveCount(0);
});

test("retry cleans the previous upload even when its queued copy is removed", async ({
  page,
}) => {
  await page.route(
    "**/api/v1/mail/messages/msg-roadmap",
    async (requestRoute) => {
      const response = await requestRoute.fetch();
      const payload = (await response.json()) as {
        data: { attachments: unknown[] };
      };
      payload.data.attachments = sources;
      await requestRoute.fulfill({ json: payload, response });
    },
  );
  let releaseFirstRetry: () => void = () => undefined;
  const firstRetryGate = new Promise<void>((resolve) => {
    releaseFirstRetry = resolve;
  });
  const attempts = new Map<string, number>();
  await page.route(
    "**/api/v1/mail/messages/*/attachments/*/imports",
    async (requestRoute) => {
      const segments = new URL(requestRoute.request().url()).pathname.split("/");
      const sourceId = decodeURIComponent(segments.at(-2) ?? "");
      const attempt = (attempts.get(sourceId) ?? 0) + 1;
      attempts.set(sourceId, attempt);
      if (sourceId === sources[0]?.id && attempt === 2) {
        await firstRetryGate;
      }
      const source = sources.find(({ id }) => id === sourceId);
      await requestRoute
        .fulfill({
          json: {
            data: {
              expiresAt: "2099-01-01T00:00:00.000Z",
              id:
                sourceId === sources[0]?.id
                  ? "a".repeat(32)
                  : "b".repeat(32),
              mimeType: source?.mimeType,
              name: source?.name,
              size: source?.size,
            },
          },
          status: 201,
        })
        .catch(() => undefined);
    },
  );
  const deletedIds: string[] = [];
  await page.route("**/api/v1/mail/attachments/**", async (requestRoute) => {
    if (requestRoute.request().method() !== "DELETE") {
      await requestRoute.continue();
      return;
    }
    const segments = new URL(requestRoute.request().url()).pathname.split("/");
    deletedIds.push(decodeURIComponent(segments.at(-1) ?? ""));
    await requestRoute.fulfill({ status: 204 });
  });
  await page.route("**/api/v1/mail/send", async (requestRoute) => {
    await requestRoute.fulfill({
      json: {
        error: {
          code: "ATTACHMENT_EXPIRED",
          message: "Attachment reservation expired.",
        },
      },
      status: 410,
    });
  });

  await page
    .getByRole("button", { name: "Open Revised product roadmap · Q3" })
    .click();
  await page.getByRole("button", { name: "Forward" }).click();
  const dialog = page.getByRole("dialog", { name: "Compose message" });
  await expect(dialog.getByText("application/pdf")).toBeVisible();
  await expect(dialog.getByText("text/plain")).toBeVisible();
  await dialog
    .getByRole("textbox", { exact: true, name: "To" })
    .fill("recipient@example.com");
  await dialog.getByRole("button", { name: /^Send$/ }).click();
  await expect(
    dialog.getByRole("button", { name: "Retry copying roadmap.pdf" }),
  ).toBeVisible();

  await dialog
    .getByRole("button", { name: "Retry copying roadmap.pdf" })
    .click();
  await expect.poll(() => attempts.get(sources[0]?.id ?? "")).toBe(2);
  await dialog
    .getByRole("button", { name: "Retry copying notes.txt" })
    .click();
  await expect.poll(() => deletedIds).toContain("b".repeat(32));
  await dialog.getByRole("button", { name: "Remove notes.txt" }).click();

  releaseFirstRetry();
  await expect(dialog.getByText("application/pdf")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(attempts.get(sources[1]?.id ?? "")).toBe(1);
});
