import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MEMBER_CONNECTION_TTL_MS } from "@/domain/provider/connection-lifetime-policy";

import {
  installRecoveryDatabase,
  recoveryDatabase,
} from "./support/composer-recovery-browser";

const ids = {
  first: "11111111-1111-4111-8111-111111111111",
  second: "22222222-2222-4222-8222-222222222222",
  third: "33333333-3333-4333-8333-333333333333",
} as const;

interface JournalOptions {
  readonly composeId?: string;
  readonly marker?: string;
  readonly recordId?: string;
  readonly revision?: number;
  readonly scope?: string;
  readonly updatedAt?: number;
}

const baseline = Date.now();

const journal = ({
  composeId = "compose-a",
  marker = "initial",
  recordId = ids.first,
  revision = 1,
  scope = "scope-a",
  updatedAt = baseline,
}: JournalOptions = {}) => ({
  composeId,
  marker,
  owner: {
    sessionExpiresAt: new Date(baseline + MEMBER_CONNECTION_TTL_MS).toISOString(),
    sessionScope: scope,
  },
  recordId,
  storageRevision: revision,
  updatedAt: new Date(updatedAt).toISOString(),
});

const openPage = async (
  context: BrowserContext,
  path = "/api/health",
): Promise<Page> => {
  const page = await context.newPage();
  await page.goto(path);
  await installRecoveryDatabase(page);
  return page;
};

const withContext = async (
  browser: Browser,
  baseURL: string | undefined,
  run: (context: BrowserContext) => Promise<void>,
) => {
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    bypassCSP: true,
  });
  try {
    await run(context);
  } finally {
    await context.close();
  }
};

test("commits exact writes and atomically aborts divergent duplicates", async ({
  baseURL,
  browser,
}) => withContext(browser, baseURL, async (context) => {
  const database = recoveryDatabase(await openPage(context));
  const original = journal();
  await database.put(original);
  await database.put(original);

  await expect(database.put(journal({ marker: "divergent" })))
    .rejects.toThrow(/write conflict/iu);
  await expect(database.put(journal({ recordId: ids.second, revision: 2 })))
    .rejects.toThrow(/write conflict/iu);
  await expect(database.get(ids.first)).resolves.toEqual(original);

  const anotherScope = journal({ recordId: ids.second, scope: "scope-b" });
  await database.put(anotherScope);
  await expect(database.get(ids.second)).resolves.toEqual(anotherScope);
}));

test("enforces initial and compare-and-swap revision sequencing", async ({
  baseURL,
  browser,
}) => withContext(browser, baseURL, async (context) => {
  const database = recoveryDatabase(await openPage(context));
  await expect(database.put(journal({ revision: 2 })))
    .rejects.toThrow(/write conflict/iu);

  const first = journal();
  const second = journal({ marker: "second", revision: 2 });
  await database.put(first);
  await database.put(second);
  await expect(database.put(first)).rejects.toThrow(/write conflict/iu);
  await expect(database.put(journal({ marker: "leap", revision: 4 })))
    .rejects.toThrow(/write conflict/iu);
  await expect(database.get(ids.first)).resolves.toEqual(second);
}));

test("transactionally retains only the newest four of forty records", async ({
  baseURL,
  browser,
}) => withContext(browser, baseURL, async (context) => {
  const database = recoveryDatabase(await openPage(context));
  const values = Array.from({ length: 40 }, (_, index) => {
    const suffix = index.toString().padStart(12, "0");
    return journal({
      composeId: `compose-${index}`,
      recordId: `50000000-0000-4000-8000-${suffix}`,
      updatedAt: baseline + index,
    });
  });
  for (const value of values) await database.put(value, baseline);

  const retained = await database.discoverScope("scope-a", 64);
  expect(retained.map(({ recordId }) => recordId)).toEqual(
    values.slice(-4).reverse().map(({ recordId }) => recordId),
  );
  for (const { recordId } of retained) await database.remove(recordId, baseline);
  await expect(database.discoverScope("scope-a", 64)).resolves.toEqual([]);
  await expect(database.put(values[0], baseline)).rejects.toThrow(/revoked/iu);
}));

test("revokes stale writers across tabs after scope and record purge", async ({
  baseURL,
  browser,
}) => withContext(browser, baseURL, async (context) => {
  const first = recoveryDatabase(await openPage(context));
  const second = recoveryDatabase(await openPage(context));
  const scoped = journal();
  const survivor = journal({
    composeId: "compose-survivor", recordId: ids.third, scope: "scope-b",
  });
  await first.put(scoped);
  await first.put(survivor);
  await second.purgeScope("scope-a");

  await expect(first.get(ids.first)).resolves.toBeNull();
  await expect(first.get(ids.third)).resolves.toEqual(survivor);
  await expect(first.put(scoped)).rejects.toThrow(/revoked/iu);

  const record = journal({ recordId: ids.second, scope: "scope-b" });
  await first.put(record);
  await second.remove(ids.second);
  await expect(first.get(ids.second)).resolves.toBeNull();
  await expect(first.put(record)).rejects.toThrow(/revoked/iu);
}));

test("concurrent scope purge cannot leave a recoverable stale write", async ({
  baseURL,
  browser,
}) => withContext(browser, baseURL, async (context) => {
  const first = recoveryDatabase(await openPage(context));
  const second = recoveryDatabase(await openPage(context));
  const racing = journal({ recordId: ids.third });

  const [purge] = await Promise.allSettled([
    first.purgeScope("scope-a"),
    second.put(racing),
  ]);
  expect(purge.status).toBe("fulfilled");
  await expect(first.get(ids.third)).resolves.toBeNull();
  await expect(second.put(racing)).rejects.toThrow(/revoked/iu);
}));
