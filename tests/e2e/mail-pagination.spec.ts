import { expect, test } from "@playwright/test";

import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("loads the next cursor page without losing the open message", async ({
  page,
}) => {
  const fixtureCursor = "opaque-pagination-fixture";
  const requestedCursors: string[] = [];
  let firstFixture: Record<string, unknown> | null = null;
  const baselineResponse = await page.request.get("/api/v1/mail/workspace");
  expect(baselineResponse.ok()).toBe(true);
  const baseline = await baselineResponse.json() as {
    data: {
      messages: {
        items: Array<Record<string, unknown>>;
        nextCursor: string | null;
        total: number;
      };
    };
  };
  await page.route("**/api/v1/mail/workspace**", async (route) => {
    const envelope = structuredClone(baseline);
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor) requestedCursors.push(cursor);
    const first = cursor ? firstFixture : envelope.data.messages.items[0];
    if (!first) throw new Error("The pagination fixture requires one message.");
    firstFixture = first;
    envelope.data.messages = cursor
      ? {
          items: [
            {
              ...first,
              id: "msg-page-two",
              subject: "Second cursor page",
              threadId: "thread-page-two",
            },
          ],
          nextCursor: null,
          total: 2,
        }
      : { items: [first], nextCursor: fixtureCursor, total: 2 };
    await route.fulfill({ json: envelope, status: 200 });
  });
  await page.reload();

  const firstMessage = page.getByRole("button", {
    name: "Open Your Stalwart workspace is ready",
  });
  await expect(firstMessage).toBeVisible();
  await firstMessage.click();
  await expect(
    page.getByRole("heading", { name: "Your Stalwart workspace is ready" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Load more messages" }).click();

  await expect(
    page.getByRole("button", { name: "Open Second cursor page" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your Stalwart workspace is ready" }),
  ).toBeVisible();
  expect(requestedCursors).toEqual([fixtureCursor]);
  await expect(
    page.getByRole("button", { name: "Load more messages" }),
  ).toHaveCount(0);
});
