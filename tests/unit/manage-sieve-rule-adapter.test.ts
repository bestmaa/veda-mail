import { describe, expect, it, vi } from "vitest";

import type { RuleDeploymentInput } from "@/domain/mail/rule";
import { ManageSieveClient } from "@/infrastructure/providers/imap-smtp/manage-sieve-client";
import type { ManageSieveError } from "@/infrastructure/providers/imap-smtp/manage-sieve-errors";
import { ManageSieveRuleAdapter } from "@/infrastructure/providers/imap-smtp/manage-sieve-rule-adapter";
import type {
  ManageSieveResponse,
  ManageSieveSession,
} from "@/infrastructure/providers/imap-smtp/manage-sieve-transport";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import type { StalwartSieveCompiler } from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-content";

const marker = "# owned\r\n";
const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com",
  imapPort: "993",
  imapSecurity: "tls",
  manageSieveHost: "sieve.example.com",
  manageSievePort: "4190",
  manageSieveSecurity: "tls",
  secret: "secret",
  smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "0",
  smtpPort: "465",
  smtpSecurity: "tls",
  username: "member@example.com",
};
const ok = (lines: readonly string[] = [], literal: Uint8Array | null = null): ManageSieveResponse =>
  ({ lines, literal, status: "OK" });
const no = (): ManageSieveResponse => ({ lines: [], literal: null, status: "NO" });
const input = (expectedProviderState: string | null = null): RuleDeploymentInput => ({
  expectedProviderState,
  rules: [],
});
const compiler: StalwartSieveCompiler = {
  compile: vi.fn(() => ({ content: `${marker}keep;\r\n`, requiredExtensions: [] })),
  verifyOwnership: vi.fn((content: string) => content.startsWith(marker)),
};

const harness = (initial: {
  active?: string;
  content?: string;
  driftAfterCheck?: string;
  extraActive?: string;
  failCommand?: string;
  foreignAfterPut?: boolean;
  requiredExtensions?: readonly string[];
  sieve?: string;
} = {}) => {
  let active = initial.active;
  let content = initial.content;
  const commands: string[] = [];
  const session: ManageSieveSession = {
    close: vi.fn(async () => undefined),
    command: vi.fn(async (command, literal) => {
      commands.push(command);
      if (command === initial.failCommand) return no();
      if (command === "CAPABILITY") {
        return ok([
          '"IMPLEMENTATION" "test"',
          '"SASL" "PLAIN"',
          `"SIEVE" "${initial.sieve ?? "fileinto imap4flags envelope"}"`,
        ]);
      }
      if (command.startsWith("AUTHENTICATE")) return ok();
      if (command === "LISTSCRIPTS") {
        return ok([
          ...(active ? [`"${active}" ACTIVE`] : content ? ['"Veda Mail Rules"'] : []),
          ...(initial.extraActive ? [`"${initial.extraActive}" ACTIVE`] : []),
        ]);
      }
      if (command.startsWith("GETSCRIPT")) {
        return ok([], new TextEncoder().encode(content ?? ""));
      }
      if (command === "CHECKSCRIPT") {
        if (initial.driftAfterCheck) content = initial.driftAfterCheck;
        return ok();
      }
      if (command.startsWith("PUTSCRIPT")) {
        content = new TextDecoder().decode(literal);
        if (initial.foreignAfterPut) active = "Vacation";
        return ok();
      }
      if (command.startsWith("SETACTIVE")) {
        active = "Veda Mail Rules";
        return ok();
      }
      throw new Error("Unexpected command");
    }),
  };
  const client = new ManageSieveClient(config, async () => session);
  const configuredCompiler: StalwartSieveCompiler = {
    ...compiler,
    compile: vi.fn(() => ({
      content: `${marker}keep;\r\n`,
      requiredExtensions: initial.requiredExtensions ?? [],
    })),
  };
  return {
    adapter: new ManageSieveRuleAdapter(client, configuredCompiler),
    commands,
    session,
  };
};

describe("ManageSieve rules adapter", () => {
  it("discovers only actions backed by advertised extensions", async () => {
    const { adapter } = harness();
    const capability = await adapter.getCapability();
    expect(capability).toMatchObject({
      supported: true,
      supportedActions: ["discard", "move", "label", "mark-read", "star"],
    });
    expect(capability.supportedConditions).toContain("recipient");
    expect(capability.supportedConditions).not.toContain("attachment");
  });

  it("keeps rules visibly unsupported when discovery is rejected", async () => {
    const { adapter, session } = harness({ failCommand: "CAPABILITY" });

    await expect(adapter.getCapability()).resolves.toMatchObject({
      reason: "ManageSieve discovery or authentication failed.",
      supported: false,
    });
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("rejects a rule requiring an unadvertised extension before mutation", async () => {
    const { adapter, commands } = harness({
      requiredExtensions: ["fileinto"],
      sieve: "imap4flags",
    });

    await expect(adapter.deploy(input())).rejects.toMatchObject({
      code: "RULE_PROVIDER_UNSUPPORTED",
    } satisfies Partial<ManageSieveError>);
    expect(commands).not.toContain("LISTSCRIPTS");
  });

  it("installs, activates, and verifies an owned script", async () => {
    const { adapter, commands, session } = harness();
    const result = await adapter.deploy(input());
    expect(result).toMatchObject({ scriptId: "Veda Mail Rules", status: "deployed" });
    expect(commands).toContain("CHECKSCRIPT");
    expect(session.command).toHaveBeenCalledWith(
      "CHECKSCRIPT",
      expect.any(Uint8Array),
      { appendCommandTerminator: true },
    );
    expect(commands).toContain('PUTSCRIPT "Veda Mail Rules"');
    expect(session.command).toHaveBeenCalledWith(
      'PUTSCRIPT "Veda Mail Rules"',
      expect.any(Uint8Array),
      { appendCommandTerminator: true },
    );
    expect(commands).toContain('SETACTIVE "Veda Mail Rules"');
    expect(commands.at(-1)).toBe('GETSCRIPT "Veda Mail Rules"');
  });

  it("never deactivates or overwrites a foreign active script", async () => {
    const { adapter, commands } = harness({ active: "Vacation" });
    await expect(adapter.deploy(input())).rejects.toMatchObject({
      code: "RULE_PROVIDER_CONFLICT",
    } satisfies Partial<ManageSieveError>);
    expect(commands.some((command) => command.startsWith("PUTSCRIPT"))).toBe(false);
    expect(commands.some((command) => command.startsWith("SETACTIVE"))).toBe(false);
  });

  it("does not deactivate a foreign script activated during deployment", async () => {
    const { adapter, commands } = harness({ foreignAfterPut: true });
    await expect(adapter.deploy(input())).rejects.toMatchObject({
      code: "RULE_PROVIDER_CONFLICT",
    } satisfies Partial<ManageSieveError>);
    expect(commands.some((command) => command.startsWith("SETACTIVE"))).toBe(false);
  });

  it("rejects ambiguous active provider state without mutation", async () => {
    const { adapter, commands } = harness({
      active: "Veda Mail Rules",
      content: `${marker}old;\r\n`,
      extraActive: "Another script",
    });

    await expect(adapter.deploy(input())).rejects.toMatchObject({
      code: "RULE_PROVIDER_CONFLICT",
    } satisfies Partial<ManageSieveError>);
    expect(commands.some((command) => command.startsWith("PUTSCRIPT"))).toBe(false);
  });

  it("detects provider drift between CHECKSCRIPT and deployment", async () => {
    const { adapter, commands } = harness({
      active: "Veda Mail Rules",
      content: `${marker}old;\r\n`,
      driftAfterCheck: `${marker}changed;\r\n`,
    });

    await expect(adapter.deploy(input())).rejects.toMatchObject({
      code: "RULE_PROVIDER_CONFLICT",
    } satisfies Partial<ManageSieveError>);
    expect(commands.some((command) => command.startsWith("PUTSCRIPT"))).toBe(false);
  });

  it.each(["CHECKSCRIPT", 'PUTSCRIPT "Veda Mail Rules"', 'SETACTIVE "Veda Mail Rules"'])(
    "fails closed when %s is rejected",
    async (failCommand) => {
      const { adapter, session } = harness({ failCommand });

      await expect(adapter.deploy(input())).rejects.toMatchObject({
        code: "RULE_PROVIDER_REJECTED",
      } satisfies Partial<ManageSieveError>);
      expect(session.close).toHaveBeenCalledOnce();
    },
  );

  it("rejects an existing same-name script without the installation marker", async () => {
    const { adapter, commands } = harness({ content: "keep;\r\n" });
    await expect(adapter.deploy(input())).rejects.toMatchObject({
      code: "RULE_PROVIDER_CONFLICT",
    } satisfies Partial<ManageSieveError>);
    expect(commands.some((command) => command.startsWith("PUTSCRIPT"))).toBe(false);
  });

  it("uses the owned active script hash as a best-effort CAS state", async () => {
    const { adapter, commands } = harness({
      active: "Veda Mail Rules",
      content: `${marker}old;\r\n`,
    });
    await expect(adapter.deploy(input("stale"))).rejects.toMatchObject({
      code: "RULE_PROVIDER_CONFLICT",
    } satisfies Partial<ManageSieveError>);
    expect(commands.some((command) => command.startsWith("PUTSCRIPT"))).toBe(false);
  });

  it("treats an exact owned active script as a lost-response retry", async () => {
    const { adapter, commands } = harness({
      active: "Veda Mail Rules",
      content: `${marker}keep;\r\n`,
    });
    await expect(adapter.deploy(input("stale"))).resolves.toMatchObject({
      scriptId: "Veda Mail Rules",
      status: "deployed",
    });
    expect(commands).not.toContain("CHECKSCRIPT");
    expect(commands.some((command) => command.startsWith("PUTSCRIPT"))).toBe(false);
  });
});
