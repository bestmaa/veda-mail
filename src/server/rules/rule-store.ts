import "server-only";

import type { ProviderConnection } from "@/domain/provider/provider";
import { updateRuleBook } from "@/server/rules/rule-book";
import { decryptRuleBook, encryptRuleBook, ruleOwnerKey } from "@/server/rules/rule-crypto";
import { readRuleFile, writeRuleFile } from "@/server/rules/rule-file";
import { assertRuleKeyCheck, ruleKeyCheck } from "@/server/rules/rule-key";
import {
  type MailRuleOwner,
  emptyRuleBookProjection,
  MAX_RULE_OWNERS,
  projectRuleBook,
  type RuleBookProjection,
  type RuleDeploymentWork,
  type StoredRuleBook,
} from "@/server/rules/rule-record";
import {
  ensureRulesMigrated,
  replaceSharedRuleBook,
  sharedRuleBook,
} from "@/server/rules/rule-shared-store";
import type { RuleStoreOperation } from "@/server/rules/rule-store-operation";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & {
  __vedaMailRuleQueue?: Promise<void>;
};
globalState.__vedaMailRuleQueue ??= Promise.resolve();

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailRuleQueue!.then(task, task);
  globalState.__vedaMailRuleQueue = result.then(() => undefined, () => undefined);
  return result;
};

const fail = (message: string, code: string, status: number): never => {
  throw new ApiError(message, code, status);
};
const unavailable = (): never => fail(
  "Mail rules are temporarily unavailable.", "MAIL_RULE_STORE_UNAVAILABLE", 500,
);

const conflict = (): never => fail(
  "Mail rules changed in another session. Reload and try again.",
  "MAIL_RULE_BOOK_CONFLICT", 409,
);

const sharedMode = async (): Promise<boolean> => {
  try { return await ensureRulesMigrated(); }
  catch { return unavailable(); }
};

const load = async (owner: MailRuleOwner) => {
  try {
    const file = await readRuleFile();
    if (file.keyCheck) assertRuleKeyCheck(file.keyCheck);
    const ownerKey = ruleOwnerKey(owner);
    return {
      book: file.owners[ownerKey]
        ? decryptRuleBook(file.owners[ownerKey]!, ownerKey)
        : null,
      file,
      ownerKey,
    };
  } catch {
    return unavailable();
  }
};

const assertRevision = (
  book: StoredRuleBook | null,
  expected: string | null,
): void => {
  if ((book?.revision ?? null) !== expected) fail(
    "Mail rules changed in another session. Reload and try again.",
    "MAIL_RULE_BOOK_CONFLICT", 409,
  );
};

const persist = async (
  current: Awaited<ReturnType<typeof load>>,
  book: StoredRuleBook,
): Promise<RuleBookProjection> => {
  if (!current.file.owners[current.ownerKey] &&
      Object.keys(current.file.owners).length >= MAX_RULE_OWNERS) fail(
    "The installation cannot store another rule owner.", "MAIL_RULE_OWNER_LIMIT_REACHED", 507,
  );
  try {
    await writeRuleFile({ keyCheck: ruleKeyCheck(),
      owners: { ...current.file.owners, [current.ownerKey]: encryptRuleBook(book, current.ownerKey) },
      updatedAt: book.updatedAt, version: 1 });
    return projectRuleBook(book);
  } catch {
    return unavailable();
  }
};

export const ruleStore = {
  async get(owner: MailRuleOwner): Promise<RuleBookProjection> {
    if (await sharedMode()) {
      try {
        const current = await sharedRuleBook(owner);
        return current.book
          ? projectRuleBook(current.book)
          : emptyRuleBookProjection();
      } catch {
        return unavailable();
      }
    }
    const current = await load(owner);
    return current.book ? projectRuleBook(current.book) : emptyRuleBookProjection();
  },
  async persistDeploymentIntent(
    owner: MailRuleOwner,
    expectedRevision: string,
    connection: ProviderConnection,
  ): Promise<RuleDeploymentWork> {
    const projection = await ruleStore.put(owner, {
      connection, expectedRevision, operation: "persist-deployment-intent",
    });
    return ruleStore.getDeploymentWork(owner, projection.deployment.intentId!);
  },
  async getDeploymentWork(owner: MailRuleOwner, intentId: string): Promise<RuleDeploymentWork> {
    let book: StoredRuleBook | null;
    if (await sharedMode()) {
      try { ({ book } = await sharedRuleBook(owner)); }
      catch { return unavailable(); }
    } else ({ book } = await load(owner));
    const ready = book ?? unavailable();
    const connection = ready.connection ?? fail(
      "The mail-rule deployment intent is unavailable.", "MAIL_RULE_DEPLOYMENT_CONFLICT", 409,
    );
    if (ready.deployment.status !== "pending" ||
        ready.deployment.intentId !== intentId) fail(
      "The mail-rule deployment intent is unavailable.", "MAIL_RULE_DEPLOYMENT_CONFLICT", 409,
    );
    return { connection, desiredRevision: ready.deployment.desiredRevision!,
      intentId, rules: ready.rules };
  },
  async put(owner: MailRuleOwner, operation: RuleStoreOperation): Promise<RuleBookProjection> {
    return serialized(async () => {
      if (await sharedMode()) {
        let current;
        try { current = await sharedRuleBook(owner); }
        catch { return unavailable(); }
        assertRevision(current.book, operation.expectedRevision);
        const now = new Date().toISOString();
        const updated = updateRuleBook(current.book, operation, now);
        try {
          if (!await replaceSharedRuleBook(current, updated)) conflict();
        } catch (error) {
          if (error instanceof ApiError) throw error;
          return unavailable();
        }
        return projectRuleBook(updated);
      }
      const current = await load(owner);
      assertRevision(current.book, operation.expectedRevision);
      const now = new Date().toISOString();
      const updated = updateRuleBook(current.book, operation, now);
      return persist(current, updated);
    });
  },
};
