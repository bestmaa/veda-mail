import { expect, test, type Page } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

interface MoveFixtureState {
  body: Record<string, unknown> | null;
  customId: string;
  firstId: string;
  secondId: string;
  sourceId: string;
}

const installMoveFixture = async (
  page: Page,
  options: { readonly partial?: boolean; readonly second?: boolean } = {},
): Promise<MoveFixtureState> => {
  const state: MoveFixtureState = {
    body: null,
    customId: "custom-projects",
    firstId: "",
    secondId: "message-move-second",
    sourceId: "",
  };
  const moved = new Set<string>();
  await page.route("**/api/v1/mail/workspace**", async (route) => {
    const response = await route.fetch();
    const envelope = (await response.json()) as {
      data: {
        mailboxes: Array<Record<string, unknown>>;
        messages: {
          items: Array<Record<string, unknown>>;
          nextCursor: string | null;
          total: number;
        };
      };
    };
    state.sourceId = String(envelope.data.mailboxes.find(
      (mailbox) => mailbox["role"] === "inbox",
    )?.["id"] ?? "");
    const first = envelope.data.messages.items[0];
    if (!first || !state.sourceId) throw new Error("Move fixture is incomplete.");
    state.firstId = String(first["id"]);
    if (!envelope.data.mailboxes.some(({ id }) => id === state.customId)) {
      envelope.data.mailboxes.push({
        color: "#64748b",
        id: state.customId,
        name: "Projects",
        parentId: null,
        rights: {
          mayAddItems: true,
          mayCreateChild: true,
          mayDelete: true,
          mayRemoveItems: true,
          mayRename: true,
        },
        role: "custom",
        sortOrder: 1_000,
        total: 0,
        unread: 0,
      });
    }
    const items = options.second
      ? [first, {
          ...first,
          id: state.secondId,
          subject: "Move project follow-up",
          threadId: "thread-move-second",
        }]
      : [first];
    const visible = items.filter(({ id }) => !moved.has(String(id)));
    envelope.data.messages = {
      items: visible,
      nextCursor: null,
      total: visible.length,
    };
    await route.fulfill({ json: envelope, response });
  });
  await page.route("**/api/v1/mail/messages/bulk", async (route) => {
    state.body = route.request().postDataJSON() as Record<string, unknown>;
    const requested = state.body["messageIds"] as string[];
    const failed = options.partial ? [state.secondId] : [];
    const succeeded = requested.filter((messageId) => !failed.includes(messageId));
    succeeded.forEach((messageId) => moved.add(messageId));
    await route.fulfill({
      json: { data: { failed, succeeded } },
      status: 200,
    });
  });
  await page.reload();
  return state;
};

const rowFor = (page: Page, subject: string) => page.locator("article").filter({
  has: page.getByRole("button", { name: `Open ${subject}` }),
});

test("drags one message with an opaque internal intent and rejects external drops", async ({
  page,
}) => {
  const state = await installMoveFixture(page);
  const projects = page.getByRole("button", { name: "Projects" }).locator("..");
  const external = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "attacker-controlled-message-id");
    return transfer;
  });
  await projects.dispatchEvent("dragover", { dataTransfer: external });
  await projects.dispatchEvent("drop", { dataTransfer: external });
  expect(state.body).toBeNull();

  await rowFor(page, "Your Stalwart workspace is ready").dragTo(projects);

  await expect.poll(() => state.body).toEqual({
    destinationMailboxId: state.customId,
    messageIds: [state.firstId],
    sourceMailboxId: state.sourceId,
    type: "move",
  });
  await expect(page.getByText("1 message moved.")).toBeAttached();
  await expect(page.getByRole("button", {
    name: "Open Your Stalwart workspace is ready",
  })).toHaveCount(0);
});

test("drags the selected group and keeps provider failures selected", async ({ page }) => {
  const state = await installMoveFixture(page, { partial: true, second: true });
  const first = page.getByRole("checkbox", {
    name: "Select Your Stalwart workspace is ready",
  });
  const second = page.getByRole("checkbox", {
    name: "Select Move project follow-up",
  });
  await first.check();
  await second.check();
  await expectNoSeriousAccessibilityViolations(page);

  await rowFor(page, "Your Stalwart workspace is ready").dragTo(
    page.getByRole("button", { name: "Projects" }).locator(".."),
  );

  await expect.poll(() => state.body?.["messageIds"]).toEqual([
    state.firstId,
    state.secondId,
  ]);
  await expect(page.getByText("1 moved; 1 failed and remain selected.")).toBeAttached();
  await expect(first).toHaveCount(0);
  await expect(second).toBeChecked();
});

test("reader exposes the complete keyboard move alternative", async ({ page }) => {
  const state = await installMoveFixture(page);
  await page.getByRole("button", {
    name: "Open Your Stalwart workspace is ready",
  }).click();
  const readerMove = page.getByRole("button", { name: "Move message" });
  await expect(readerMove).toBeEnabled();
  await readerMove.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Move Your Stalwart workspace is ready",
  });
  await expect(dialog).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  const projects = dialog.getByRole("button", { name: "Projects" });
  await projects.press("Enter");
  await expect.poll(() => state.body?.["destinationMailboxId"]).toBe(state.customId);
});

test("mobile keeps the non-pointer bulk Move control reachable", async ({ page }) => {
  const state = await installMoveFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const selection = page.getByRole("checkbox", {
    name: "Select Your Stalwart workspace is ready",
  });
  await selection.check();
  const select = page.getByRole("combobox", { name: "Move selected messages" });
  await expect(select).toBeVisible();
  await select.selectOption(state.customId);
  await expect.poll(() => state.body?.["type"]).toBe("move");
});
