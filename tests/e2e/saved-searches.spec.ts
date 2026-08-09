import { expect, test } from "@playwright/test";
import { useInstalledMailbox } from "./support/mail-fixture";

useInstalledMailbox();

test("saves, reloads, replays, and deletes an account-scoped search", async ({ page }) => {
  const baselineResponse = await page.request.get("/api/v1/mail/workspace");
  expect(baselineResponse.ok()).toBe(true);
  const baseline = await baselineResponse.json();
  const searches: Array<{ createdAt: string; id: string; name: string; query: string;
    updatedAt: string; version: 1 }> = [];
  let revision: string | null = null;
  const envelope = () => ({ data: { createdAt: searches.length ? "2026-08-09T00:00:00.000Z" : null,
    revision, searches, updatedAt: searches.length ? "2026-08-09T00:00:00.000Z" : null, version: 1 } });
  await page.route("**/api/v1/member/saved-searches", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: envelope() });
    const operation = route.request().postDataJSON() as { name?: string; operation: string; query?: string; searchId?: string };
    if (operation.operation === "create") searches.push({
      createdAt: "2026-08-09T00:00:00.000Z", id: "11111111-1111-4111-8111-111111111111",
      name: operation.name!, query: operation.query!, updatedAt: "2026-08-09T00:00:00.000Z", version: 1,
    });
    if (operation.operation === "delete") searches.splice(searches.findIndex(({ id }) => id === operation.searchId), 1);
    revision = searches.length ? crypto.randomUUID() : null;
    return route.fulfill({ json: envelope(), status: operation.operation === "create" ? 201 : 200 });
  });
  const workspaceQueries: string[] = [];
  await page.route("**/api/v1/mail/workspace**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("search");
    if (query) workspaceQueries.push(query);
    await route.fulfill({ json: baseline });
  });
  await page.reload();

  const searchbox = page.getByRole("searchbox", { name: "Search mail" });
  await searchbox.fill("from:ada@example.com is:unread");
  await searchbox.press("Enter");
  await page.getByLabel("Manage saved searches").click();
  await page.getByRole("textbox", { name: "Saved search name" }).fill("Unread from Ada");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTitle("from:ada@example.com is:unread")).toBeVisible();

  await page.reload();
  await page.getByLabel("Manage saved searches").click();
  await page.getByTitle("from:ada@example.com is:unread").click();
  await expect.poll(() => workspaceQueries.at(-1)).toBe("from:ada@example.com is:unread");
  await expect(searchbox).toHaveValue("from:ada@example.com is:unread");
  await page.getByRole("button", { name: "Delete saved search Unread from Ada" }).click();
  await expect(page.getByText("No saved searches yet.")).toBeVisible();
});
