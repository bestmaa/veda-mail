import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MailRuleDefinition } from "@/domain/mail/rule";
import { id } from "@/domain/shared/brand";
import type { MailRuleOwner } from "@/server/rules/rule-record";
import { ruleStore } from "@/server/rules/rule-store";

const originalData = process.env["VEDA_MAIL_DATA_DIR"];
const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
let directory = "";
const owner: MailRuleOwner = { email: "member@example.com", providerId: "mock" };
const definition = (name: string): MailRuleDefinition => ({
  actions: [{ kind: "star" }],
  conditions: [{ kind: "subject", operator: "contains", value: "private phrase" }],
  enabled: true,
  match: "all",
  name,
  stopProcessing: false,
});
const connection = {
  config: { accessToken: "provider-secret" },
  createdAt: "2026-08-04T00:00:00.000Z",
  displayName: "Private account",
  id: id.connection("11111111-1111-4111-8111-111111111111"),
  providerId: id.provider("mock"),
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-mail-rules-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 7).toString("base64");
});

afterEach(async () => {
  if (originalData === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalData;
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
  await rm(directory, { force: true, recursive: true });
});

describe("mail rule store", () => {
  it("supports revisioned CRUD, toggling, and exact reordering", async () => {
    const first = await ruleStore.put(owner, {
      definition: definition("First"), expectedRevision: null, operation: "create",
    });
    const second = await ruleStore.put(owner, {
      definition: definition("Second"), expectedRevision: first.revision, operation: "create",
    });
    const [firstRule, secondRule] = second.rules;
    const reordered = await ruleStore.put(owner, {
      expectedRevision: second.revision,
      operation: "reorder",
      ruleIds: [secondRule!.id, firstRule!.id],
    });
    expect(reordered.rules.map(({ name }) => name)).toEqual(["Second", "First"]);
    const toggled = await ruleStore.put(owner, {
      enabled: false, expectedRevision: reordered.revision,
      operation: "toggle", ruleId: secondRule!.id,
    });
    expect(toggled.rules[0]?.enabled).toBe(false);
    const updated = await ruleStore.put(owner, {
      definition: definition("Renamed"), expectedRevision: toggled.revision,
      operation: "update", ruleId: firstRule!.id,
    });
    const deleted = await ruleStore.put(owner, {
      expectedRevision: updated.revision, operation: "delete", ruleId: firstRule!.id,
    });
    expect(deleted.rules).toHaveLength(1);
    await expect(ruleStore.put(owner, {
      enabled: true, expectedRevision: toggled.revision,
      operation: "toggle", ruleId: secondRule!.id,
    })).rejects.toMatchObject({ code: "MAIL_RULE_BOOK_CONFLICT", status: 409 });
  });

  it("CAS-binds deployment intent and returns connection only as work", async () => {
    const created = await ruleStore.put(owner, {
      definition: definition("Deploy"), expectedRevision: null, operation: "create",
    });
    const work = await ruleStore.persistDeploymentIntent(
      owner, created.revision!, connection,
    );
    expect(work.connection.config).toEqual({ accessToken: "provider-secret" });
    const pending = await ruleStore.get(owner);
    expect(pending.deployment).toMatchObject({
      intentId: work.intentId, status: "pending",
    });
    expect(JSON.stringify(pending)).not.toContain("provider-secret");
    const deployed = await ruleStore.put(owner, {
      expectedRevision: pending.revision!,
      intentId: work.intentId,
      operation: "finalize-deployment",
      result: {
        providerState: "state-1",
        scriptHash: "a".repeat(64),
        scriptId: "veda-mail-rules",
        status: "deployed",
      },
    });
    expect(deployed.deployment).toMatchObject({ status: "deployed" });
    await expect(ruleStore.getDeploymentWork(owner, work.intentId)).rejects
      .toMatchObject({ code: "MAIL_RULE_DEPLOYMENT_CONFLICT" });
    await expect(ruleStore.put(owner, {
      expectedRevision: deployed.revision!,
      intentId: work.intentId,
      operation: "finalize-deployment",
      result: { errorCode: "STALE", status: "failed" },
    })).rejects.toMatchObject({ code: "MAIL_RULE_DEPLOYMENT_CONFLICT" });
  });

  it("enforces the 50-rule owner limit", async () => {
    let revision: string | null = null;
    for (let index = 0; index < 50; index += 1) {
      const book = await ruleStore.put(owner, {
        definition: definition(`Rule ${index}`),
        expectedRevision: revision,
        operation: "create",
      });
      revision = book.revision;
    }
    await expect(ruleStore.put(owner, {
      definition: definition("Overflow"),
      expectedRevision: revision,
      operation: "create",
    })).rejects.toMatchObject({ code: "MAIL_RULE_LIMIT_REACHED", status: 422 });
  });
});
