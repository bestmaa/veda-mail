import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { MEMBER_CONNECTION_TTL_MS } from "@/domain/provider/connection-lifetime-policy";
import { RECOVERY_TOMBSTONE_RETENTION_MS } from "@/presentation/features/mail-workspace/composer-recovery-database-upgrade";
import {
  installRecoveryDatabase,
  recoveryDatabase,
} from "./support/composer-recovery-browser";

const DATABASE_NAME = "veda-mail-composer-recovery-v2";
const ids = {
  first: "41111111-1111-4111-8111-111111111111",
  second: "42222222-2222-4222-8222-222222222222",
} as const;

const journal = ({
  composeId,
  expiresAt,
  recordId,
  updatedAt,
}: {
  readonly composeId: string;
  readonly expiresAt: number;
  readonly recordId: string;
  readonly updatedAt: number;
}) => ({
  composeId,
  marker: recordId,
  owner: {
    sessionExpiresAt: new Date(expiresAt).toISOString(),
    sessionScope: "scope-a",
  },
  recordId,
  storageRevision: 1,
  updatedAt: new Date(updatedAt).toISOString(),
});

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

const pageAtOrigin = async (context: BrowserContext): Promise<Page> => {
  const page = await context.newPage();
  await page.goto("/api/health");
  return page;
};

const seedLegacyDatabase = async (
  page: Page,
  journals: readonly ReturnType<typeof journal>[],
): Promise<void> => page.evaluate(async ({ databaseName, values }) => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      const records = database.createObjectStore("records", { keyPath: "composeKey" });
      records.createIndex("record-id", "recordId", { unique: true });
      records.createIndex("session-scope", "sessionScope");
      database.createObjectStore("tombstones");
    });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("success", () => {
      const database = request.result;
      const transaction = database.transaction(
        ["records", "tombstones"], "readwrite",
      );
      const records = transaction.objectStore("records");
      for (const value of values) records.put({
        composeKey: [value.owner.sessionScope, value.composeId],
        journal: value,
        recordId: value.recordId,
        sessionScope: value.owner.sessionScope,
        storageRevision: value.storageRevision,
      });
      transaction.objectStore("tombstones").put(0, "record:legacy");
      transaction.addEventListener("complete", () => {
        database.close();
        resolve();
      }, { once: true });
      transaction.addEventListener("error", () => reject(transaction.error), { once: true });
    }, { once: true });
  });
}, { databaseName: DATABASE_NAME, values: journals });

const tombstoneCount = (page: Page): Promise<number> => page.evaluate(
  (databaseName) => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2);
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("success", () => {
      const database = request.result;
      const count = database.transaction("tombstones", "readonly")
        .objectStore("tombstones").count();
      count.addEventListener("success", () => {
        database.close();
        resolve(count.result);
      }, { once: true });
      count.addEventListener("error", () => reject(count.error), { once: true });
    }, { once: true });
  }),
  DATABASE_NAME,
);

test("upgrades legacy records for bounded scope discovery and indexed expiry", async ({
  baseURL,
  browser,
}) => withContext(browser, baseURL, async (context) => {
  const now = Date.now();
  const page = await pageAtOrigin(context);
  const first = journal({
    composeId: "compose-old", expiresAt: now + 1_000,
    recordId: ids.first, updatedAt: now,
  });
  const second = journal({
    composeId: "compose-new", expiresAt: now + MEMBER_CONNECTION_TTL_MS,
    recordId: ids.second, updatedAt: now + 1,
  });
  await seedLegacyDatabase(page, [first, second]);
  await installRecoveryDatabase(page);
  const database = recoveryDatabase(page);

  await expect(database.purgeExpired(now)).resolves.toEqual([]);
  await expect(tombstoneCount(page)).resolves.toBe(0);
  await expect(database.discoverScope("scope-a", 1)).resolves.toEqual([
    { journal: second, recordId: second.recordId },
  ]);
  await expect(database.purgeExpired(now + 1_000)).resolves.toEqual([ids.first]);
  await expect(database.get(ids.first)).resolves.toBeNull();
}));

test("compacts forty pre-existing records without hidden reappearance", async ({
  baseURL,
  browser,
}) => withContext(browser, baseURL, async (context) => {
  const now = Date.now();
  const page = await pageAtOrigin(context);
  const values = Array.from({ length: 40 }, (_, index) => {
    const suffix = index.toString().padStart(12, "0");
    return journal({
      composeId: `legacy-${index}`,
      expiresAt: now + MEMBER_CONNECTION_TTL_MS,
      recordId: `60000000-0000-4000-8000-${suffix}`,
      updatedAt: now + index,
    });
  });
  await seedLegacyDatabase(page, values);
  await installRecoveryDatabase(page);
  const database = recoveryDatabase(page);

  await expect(database.trimScope("scope-a", now)).resolves.toHaveLength(36);
  const retained = await database.discoverScope("scope-a", 64);
  expect(retained.map(({ recordId }) => recordId)).toEqual(
    values.slice(-4).reverse().map(({ recordId }) => recordId),
  );
  for (const { recordId } of retained) await database.remove(recordId, now);
  await expect(database.discoverScope("scope-a", 64)).resolves.toEqual([]);
  await expect(database.put(values[0]!, now)).rejects.toThrow(/revoked/iu);
}));

test("retains tombstones past session lifetime then rejects expired resurrection", async ({
  baseURL,
  browser,
}) => withContext(browser, baseURL, async (context) => {
  const now = Date.now();
  const page = await pageAtOrigin(context);
  await installRecoveryDatabase(page);
  const database = recoveryDatabase(page);
  const value = journal({
    composeId: "compose-revoked",
    expiresAt: now + MEMBER_CONNECTION_TTL_MS,
    recordId: ids.first,
    updatedAt: now,
  });
  await database.put(value, now);
  await database.remove(value.recordId, now);

  await database.purgeExpired(now + MEMBER_CONNECTION_TTL_MS - 1);
  await expect(tombstoneCount(page)).resolves.toBe(1);
  await expect(database.put(value, now + MEMBER_CONNECTION_TTL_MS - 1))
    .rejects.toThrow(/revoked/iu);

  await database.purgeExpired(now + RECOVERY_TOMBSTONE_RETENTION_MS + 1);
  await expect(tombstoneCount(page)).resolves.toBe(0);
  await expect(database.put(value, now + RECOVERY_TOMBSTONE_RETENTION_MS + 1))
    .rejects.toThrow(/expired/iu);
}));

test("an expiry purge racing a valid stale writer cannot resurrect a record", async ({
  baseURL,
  browser,
}) => withContext(browser, baseURL, async (context) => {
  const now = Date.now();
  const expiry = now + 1_000;
  const firstPage = await pageAtOrigin(context);
  const secondPage = await pageAtOrigin(context);
  await installRecoveryDatabase(firstPage);
  await installRecoveryDatabase(secondPage);
  const first = recoveryDatabase(firstPage);
  const second = recoveryDatabase(secondPage);
  const value = journal({
    composeId: "compose-expiry-race",
    expiresAt: expiry,
    recordId: ids.first,
    updatedAt: now,
  });
  await first.put(value, now);

  const [purge] = await Promise.allSettled([
    first.purgeExpired(expiry),
    second.put({ ...value, marker: "racing", storageRevision: 2 }, expiry - 1),
  ]);
  expect(purge.status).toBe("fulfilled");
  await expect(first.get(value.recordId)).resolves.toBeNull();
  await expect(second.put(value, expiry - 1)).rejects.toThrow(/revoked/iu);
}));
