import "server-only";

import { createHash } from "node:crypto";

import {
  MAX_MAIL_RULES,
  type RuleCapability,
  type RuleDeploymentInput,
  type RuleDeploymentResult,
} from "@/domain/mail/rule";
import type { ManageSieveCompiler } from "@/infrastructure/providers/imap-smtp/manage-sieve-compiler";
import {
  VEDA_MANAGE_SIEVE_SCRIPT,
} from "@/infrastructure/providers/imap-smtp/manage-sieve-client";
import type { ManageSieveClient } from "@/infrastructure/providers/imap-smtp/manage-sieve-client";
import {
  ManageSieveError,
  manageSieveConflict,
  manageSieveRejected,
  manageSieveUnsupported,
} from "@/infrastructure/providers/imap-smtp/manage-sieve-errors";
import type { ManageSieveSession } from "@/infrastructure/providers/imap-smtp/manage-sieve-transport";

const MAX_SCRIPT_BYTES = 256 * 1024;
const hash = (content: Uint8Array): string =>
  createHash("sha256").update(content).digest("base64url");

const unsupported = (reason: string): RuleCapability => ({
  maxRules: MAX_MAIL_RULES,
  maxScriptBytes: null,
  reason,
  supported: false,
  supportedActions: [],
  supportedConditions: [],
});

const capability = (extensions: ReadonlySet<string>): RuleCapability => {
  const flags = extensions.has("imap4flags");
  const attachment = ["foreverypart", "mime", "variables"]
    .every((item) => extensions.has(item));
  return {
    maxRules: MAX_MAIL_RULES,
    maxScriptBytes: MAX_SCRIPT_BYTES,
    supported: true,
    supportedActions: [
      "discard",
      ...(extensions.has("fileinto") ? ["move" as const] : []),
      ...(flags ? ["label" as const, "mark-read" as const, "star" as const] : []),
    ],
    supportedConditions: [
      "cc", "from", "header", "size", "subject", "to",
      ...(extensions.has("envelope") ? ["recipient" as const] : []),
      ...(attachment ? ["attachment" as const] : []),
    ],
  };
};

const exactText = (bytes: Uint8Array): string => {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_SCRIPT_BYTES) {
    return manageSieveConflict("The existing Veda rules script could not be verified safely.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return manageSieveConflict("The existing Veda rules script is not valid UTF-8.");
  }
};

export class ManageSieveRuleAdapter {
  public constructor(
    private readonly client: ManageSieveClient,
    private readonly compiler: ManageSieveCompiler,
  ) {}

  public async getCapability(): Promise<RuleCapability> {
    try {
      return await this.client.use(async (_session, discovered) =>
        capability(discovered.extensions));
    } catch {
      return unsupported("ManageSieve discovery or authentication failed.");
    }
  }

  public async deploy(input: RuleDeploymentInput): Promise<RuleDeploymentResult> {
    if (input.rules.length > MAX_MAIL_RULES) manageSieveRejected();
    try {
      return await this.client.use(async (session, discovered) => {
        const preliminary = this.compiler.compileRules(input.rules, null);
        if (!this.compiler.verifyOwnership(preliminary.content)) manageSieveRejected();
        const preliminaryMissing = preliminary.requiredExtensions.find(
          (item) => !discovered.extensions.has(item.toLowerCase()),
        );
        if (preliminaryMissing) manageSieveUnsupported(
          "The provider lacks an extension required by these rules.",
        );
        const scripts = await this.client.list(session);
        const active = scripts.filter(({ active: isActive }) => isActive);
        const named = scripts.filter(({ name }) => name === VEDA_MANAGE_SIEVE_SCRIPT);
        if (active.length > 1 || named.length > 1) {
          manageSieveConflict("The provider has ambiguous active rules scripts.");
        }
        const existing = named[0] ? await this.owned(session) : null;
        if (active[0] && active[0].name !== VEDA_MANAGE_SIEVE_SCRIPT) {
          manageSieveConflict("Another provider script is active. Veda Mail left it unchanged.");
        }
        const existingText = existing ? exactText(existing) : null;
        const compiled = this.compiler.compileRules(input.rules, existingText);
        const missing = compiled.requiredExtensions.find(
          (item) => !discovered.extensions.has(item.toLowerCase()),
        );
        if (missing) manageSieveUnsupported(
          "The provider lacks an extension required by these rules or the active vacation response.",
        );
        const bytes = new TextEncoder().encode(compiled.content);
        if (bytes.byteLength < 1 || bytes.byteLength > MAX_SCRIPT_BYTES) {
          manageSieveUnsupported("The compiled rules script exceeds the provider limit.");
        }
        const providerState = existingText
          ? this.compiler.rulesRevision(existingText)
          : this.compiler.rulesRevision(null);
        const legacyProviderState = existing ? hash(existing) : hash(new Uint8Array());
        if (existing && active[0] && Buffer.from(existing).equals(Buffer.from(bytes))) {
          return this.result(bytes, providerState);
        }
        if (input.expectedProviderState !== null &&
          input.expectedProviderState !== providerState &&
          input.expectedProviderState !== legacyProviderState) {
          manageSieveConflict("Rules changed at the provider. Reload before saving.");
        }
        await this.client.check(session, bytes);
        // RFC 5804 has no atomic state token; this second owned snapshot narrows drift.
        const preflight = await this.client.list(session);
        const preflightNamed = preflight.filter(
          ({ name }) => name === VEDA_MANAGE_SIEVE_SCRIPT,
        );
        const preflightActive = preflight.filter(({ active: isActive }) => isActive);
        if (preflightNamed.length > 1 || preflightActive.length > 1 ||
          preflightActive.some(({ name }) => name !== VEDA_MANAGE_SIEVE_SCRIPT)) {
          manageSieveConflict("Provider rules changed during deployment. Nothing was activated.");
        }
        const latest = preflightNamed[0] ? await this.owned(session) : null;
        if ((latest ? hash(latest) : hash(new Uint8Array())) !== legacyProviderState) {
          manageSieveConflict("Provider rules changed during deployment. Reload before saving.");
        }
        await this.client.put(session, VEDA_MANAGE_SIEVE_SCRIPT, bytes);
        const beforeActivation = await this.client.list(session);
        if (beforeActivation.some(({ active: isActive, name }) =>
          isActive && name !== VEDA_MANAGE_SIEVE_SCRIPT)) {
          manageSieveConflict("Another provider script became active. Veda Mail left it active.");
        }
        await this.client.activate(session, VEDA_MANAGE_SIEVE_SCRIPT);
        const confirmedScripts = await this.client.list(session);
        if (!confirmedScripts.some(({ active: isActive, name }) =>
          isActive && name === VEDA_MANAGE_SIEVE_SCRIPT)) manageSieveRejected();
        const confirmed = await this.owned(session);
        if (!Buffer.from(confirmed).equals(Buffer.from(bytes))) manageSieveRejected();
        return this.result(bytes, this.compiler.rulesRevision(exactText(confirmed)));
      });
    } catch (error) {
      if (error instanceof ManageSieveError) throw error;
      return manageSieveRejected();
    }
  }

  private result(bytes: Uint8Array, providerState: string): RuleDeploymentResult {
    return {
      providerState,
      scriptHash: hash(bytes),
      scriptId: VEDA_MANAGE_SIEVE_SCRIPT,
      status: "deployed",
    };
  }

  private async owned(session: ManageSieveSession): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      bytes = await this.client.get(session, VEDA_MANAGE_SIEVE_SCRIPT);
    } catch {
      return manageSieveConflict("The existing Veda rules script could not be verified safely.");
    }
    const content = exactText(bytes);
    const owned = (candidate: string) => {
      try { return this.compiler.verifyOwnership(candidate); }
      catch { return false; }
    };
    if (owned(content)) return bytes;

    // Stalwart can expose the command-framing CRLF as part of a GETSCRIPT
    // literal even though its JMAP blob preserves the uploaded bytes. Accept
    // only one removed CRLF and only when the installation HMAC then verifies;
    // broader normalization would weaken the ownership boundary.
    if (content.endsWith("\r\n")) {
      const canonical = content.slice(0, -2);
      if (owned(canonical)) return new TextEncoder().encode(canonical);
    }
    return manageSieveConflict(
      "The provider script named for Veda Mail is not owned by this installation.",
    );
  }
}
