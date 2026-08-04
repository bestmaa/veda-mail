import "server-only";

import { createHash } from "node:crypto";

import {
  MAX_MAIL_RULES,
  type RuleDeploymentInput,
  type RuleDeploymentResult,
} from "@/domain/mail/rule";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  getStalwartRuleCapability,
  requireStalwartSieveContext,
  type StalwartSieveContext,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-rule-capability";
import {
  ruleConflict,
  ruleRejected,
  ruleUnsupported,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-rule-errors";
import type {
  StalwartSieveCompiler,
  StalwartSieveContentPort,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-content";
import {
  getStalwartSieveScripts,
  installStalwartSieveScript,
  validateStalwartSieveScript,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-operations";
import {
  VEDA_RULE_SCRIPT_NAME,
  type StalwartSieveScript,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-schema";

interface OwnedScript {
  readonly content: Uint8Array;
  readonly script: StalwartSieveScript;
}

const exactText = (bytes: Uint8Array, maximum: number): string => {
  if (bytes.byteLength < 1 || bytes.byteLength > maximum) ruleConflict(
    "The existing Veda rules script could not be verified safely.",
  );
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return ruleConflict("The existing Veda rules script is not valid UTF-8.");
  }
};

export class StalwartRuleAdapter {
  public constructor(
    private readonly client: StalwartJmapClient,
    private readonly content: StalwartSieveContentPort,
    private readonly compiler: StalwartSieveCompiler,
  ) {}

  public getCapability() {
    return getStalwartRuleCapability(this.client);
  }

  public async deploy(input: RuleDeploymentInput): Promise<RuleDeploymentResult> {
    const context = await requireStalwartSieveContext(this.client);
    if (input.rules.length > MAX_MAIL_RULES) ruleRejected();
    const snapshot = await getStalwartSieveScripts(this.client, context.accountId);
    if (snapshot.accountId !== context.accountId || snapshot.notFound.length) {
      ruleRejected();
    }
    const owned = await this.findOwned(context, snapshot.list);
    const active = snapshot.list.filter(({ isActive }) => isActive);
    if (active.length > 1 || (active[0] && active[0].id !== owned?.script.id)) {
      ruleConflict("Another provider script is active. Veda Mail left it unchanged.");
    }
    const compiled = this.compiler.compile(input.rules);
    const required = [...new Set(compiled.requiredExtensions)];
    if (
      required.length > 64 ||
      required.some((extension) =>
        !/^[A-Za-z0-9_-]{1,128}$/u.test(extension) ||
        !context.extensions.has(extension))
    ) {
      ruleUnsupported("The provider lacks an extension required by these rules.");
    }
    const bytes = new TextEncoder().encode(compiled.content);
    if (bytes.byteLength < 1 || bytes.byteLength > context.maxScriptBytes) {
      ruleUnsupported("The compiled rules script exceeds the provider limit.");
    }
    const scriptHash = createHash("sha256").update(bytes).digest("base64url");
    if (
      input.expectedProviderState !== null &&
      input.expectedProviderState !== snapshot.state
    ) {
      if (
        owned?.script.isActive &&
        Buffer.from(owned.content).equals(Buffer.from(bytes))
      ) {
        return {
          providerState: snapshot.state,
          scriptHash,
          scriptId: owned.script.id,
          status: "deployed",
        };
      }
      ruleConflict("Rules changed at the provider. Reload before saving.");
    }
    try {
      if (!this.compiler.verifyOwnership(compiled.content)) ruleRejected();
    } catch {
      return ruleRejected();
    }
    let blob: Awaited<ReturnType<StalwartSieveContentPort["upload"]>>;
    try {
      blob = await this.content.upload({
        accountId: context.accountId,
        content: bytes,
        mediaType: "application/sieve",
      });
    } catch {
      return ruleRejected();
    }
    if (
      blob.accountId !== context.accountId ||
      blob.mediaType.toLowerCase() !== "application/sieve" ||
      blob.size !== bytes.byteLength ||
      !blob.blobId || blob.blobId.length > 1_024
    ) ruleRejected();
    await validateStalwartSieveScript(this.client, context.accountId, blob.blobId);
    const result = await installStalwartSieveScript(this.client, {
      accountId: context.accountId,
      blobId: blob.blobId,
      ownedId: owned?.script.id ?? null,
      state: snapshot.state,
    });
    const scriptId = owned?.script.id ?? result.created?.["veda"]?.id;
    if (!scriptId) return ruleRejected();
    const confirmed = await getStalwartSieveScripts(
      this.client, context.accountId, [scriptId],
    );
    const installed = confirmed.list[0];
    if (!installed ||
      confirmed.accountId !== context.accountId ||
      confirmed.notFound.length || confirmed.list.length !== 1 ||
      installed.id !== scriptId || installed.name !== VEDA_RULE_SCRIPT_NAME ||
      installed.blobId !== blob.blobId || !installed.isActive
    ) return ruleRejected();
    return {
      providerState: confirmed.state,
      scriptHash,
      scriptId,
      status: "deployed",
    };
  }

  private async findOwned(
    context: StalwartSieveContext,
    scripts: readonly StalwartSieveScript[],
  ): Promise<OwnedScript | null> {
    const candidates = scripts.filter(({ name }) => name === VEDA_RULE_SCRIPT_NAME);
    if (candidates.length > 1) ruleConflict("The provider has ambiguous Veda scripts.");
    const candidate = candidates[0];
    if (!candidate) return null;
    let bytes: Uint8Array;
    try {
      bytes = await this.content.download({
        accountId: context.accountId,
        blobId: candidate.blobId,
        maxBytes: context.maxScriptBytes,
      });
    } catch {
      return ruleConflict(
        "The existing Veda rules script could not be verified safely.",
      );
    }
    let owned: boolean;
    try {
      owned = this.compiler.verifyOwnership(exactText(bytes, context.maxScriptBytes));
    } catch {
      owned = false;
    }
    if (!owned) ruleConflict("The provider script named for Veda Mail is not owned by this installation.");
    return { content: bytes, script: candidate };
  }

}
