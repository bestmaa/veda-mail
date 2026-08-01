import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";
import ts from "typescript";
import { MEMBER_CONNECTION_TTL_MS } from "@/domain/provider/connection-lifetime-policy";

interface BrowserRecoveryDatabase {
  readonly discoverScope: (
    sessionScope: string,
    limit?: number,
  ) => Promise<readonly { journal: unknown; recordId: string }[]>;
  readonly get: (recordId: string) => Promise<unknown | null>;
  readonly purgeExpired: (now: number, limit?: number) => Promise<readonly string[]>;
  readonly purgeScope: (sessionScope: string, now?: number) => Promise<void>;
  readonly put: (journal: unknown, now?: number) => Promise<readonly string[]>;
  readonly remove: (recordId: string, now?: number) => Promise<void>;
  readonly trimScope: (sessionScope: string, now?: number) =>
    Promise<readonly string[]>;
}

declare global {
  interface Window {
    __vedaRecoveryDatabase?: BrowserRecoveryDatabase;
  }
}

interface CompiledRecoveryDatabase {
  readonly database: string;
  readonly operations: string;
  readonly upgrade: string;
}

let compiledDatabase: Promise<CompiledRecoveryDatabase> | null = null;

const compile = (source: string): string => ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

const databaseSource = (): Promise<CompiledRecoveryDatabase> => {
  const root = path.join(process.cwd(), "src/presentation/features/mail-workspace");
  compiledDatabase ??= Promise.all([
    readFile(path.join(root, "composer-recovery-database.ts"), "utf8"),
    readFile(path.join(root, "composer-recovery-database-operations.ts"), "utf8"),
    readFile(path.join(root, "composer-recovery-database-upgrade.ts"), "utf8"),
  ]).then(([database, operations, upgrade]) => ({
    database: compile(database),
    operations: compile(operations),
    upgrade: compile(upgrade),
  }));
  return compiledDatabase;
};

export const installRecoveryDatabase = async (page: Page): Promise<void> => {
  const source = await databaseSource();
  await page.evaluate(({ compiled, ttl }) => {
    const upgradeExports: Record<string, unknown> = {};
    const runUpgrade = new Function("exports", "require", compiled.upgrade);
    runUpgrade(upgradeExports, () => ({ MEMBER_CONNECTION_TTL_MS: ttl }));
    const operationsExports: Record<string, unknown> = {};
    const runOperations = new Function("exports", "require", compiled.operations);
    runOperations(operationsExports, () => upgradeExports);
    const moduleExports: Record<string, unknown> = {};
    const runModule = new Function("exports", "require", compiled.database);
    runModule(moduleExports, (moduleName: string) =>
      moduleName.endsWith("composer-recovery-database-operations")
        ? operationsExports
        : upgradeExports);
    const create = moduleExports["createComposerRecoveryDatabase"];
    if (typeof create !== "function") {
      throw new Error("Recovery database factory did not load.");
    }
    window.__vedaRecoveryDatabase = (
      create as (factory: IDBFactory) => BrowserRecoveryDatabase
    )(indexedDB);
  }, { compiled: source, ttl: MEMBER_CONNECTION_TTL_MS });
};

export const recoveryDatabase = (page: Page) => ({
  discoverScope: (sessionScope: string, limit?: number) => page.evaluate(
    ({ count, scope }) => window.__vedaRecoveryDatabase!.discoverScope(scope, count),
    { count: limit, scope: sessionScope },
  ),
  get: (recordId: string) => page.evaluate(
    (id) => window.__vedaRecoveryDatabase!.get(id), recordId,
  ),
  purgeScope: (sessionScope: string) => page.evaluate(
    (scope) => window.__vedaRecoveryDatabase!.purgeScope(scope), sessionScope,
  ),
  purgeExpired: (now: number, limit?: number) => page.evaluate(
    ({ count, timestamp }) => window.__vedaRecoveryDatabase!.purgeExpired(timestamp, count),
    { count: limit, timestamp: now },
  ),
  put: (journal: unknown, now?: number) => page.evaluate(
    ({ timestamp, value }) => window.__vedaRecoveryDatabase!.put(value, timestamp),
    { timestamp: now, value: journal },
  ),
  remove: (recordId: string, now?: number) => page.evaluate(
    ({ id, timestamp }) => window.__vedaRecoveryDatabase!.remove(id, timestamp),
    { id: recordId, timestamp: now },
  ),
  trimScope: (sessionScope: string, now?: number) => page.evaluate(
    ({ scope, timestamp }) =>
      window.__vedaRecoveryDatabase!.trimScope(scope, timestamp),
    { scope: sessionScope, timestamp: now },
  ),
});
