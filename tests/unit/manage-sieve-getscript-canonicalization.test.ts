import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { ManageSieveClient } from "@/infrastructure/providers/imap-smtp/manage-sieve-client";
import type { ManageSieveError } from "@/infrastructure/providers/imap-smtp/manage-sieve-errors";
import { ManageSieveRuleAdapter } from "@/infrastructure/providers/imap-smtp/manage-sieve-rule-adapter";
import type {
  ManageSieveResponse,
  ManageSieveSession,
} from "@/infrastructure/providers/imap-smtp/manage-sieve-transport";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import type { ManageSieveCompiler } from "@/infrastructure/providers/imap-smtp/manage-sieve-compiler";

const marker = "# owned\r\n";
const canonical = `${marker}old;\r\n`;
const desired = `${marker}new;\r\n`;
const ok = (
  lines: readonly string[] = [],
  literal: Uint8Array | null = null,
): ManageSieveResponse => ({ lines, literal, status: "OK" });
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
const revision = (content: string | null): string => createHash("sha256")
  .update(content ?? "", "utf8").digest("base64url");
const compiler: ManageSieveCompiler = {
  compileRules: vi.fn(() => ({ content: desired, requiredExtensions: [] })),
  compileVacation: vi.fn(() => ({ content: desired, requiredExtensions: [] })),
  readVacation: vi.fn(() => ({ fromDate: null, htmlBody: null, isEnabled: false,
    revision: revision(null), subject: null, textBody: null, toDate: null })),
  rulesRevision: vi.fn(revision),
  verifyOwnership: vi.fn((content: string) =>
    content === canonical || content === desired),
};

const harness = (wireContent: string) => {
  let content = wireContent;
  const commands: string[] = [];
  const session: ManageSieveSession = {
    close: vi.fn(async () => undefined),
    command: vi.fn(async (command, literal) => {
      commands.push(command);
      if (command === "CAPABILITY") {
        return ok(['"SASL" "PLAIN"', '"SIEVE" "imap4flags"']);
      }
      if (command.startsWith("AUTHENTICATE")) return ok();
      if (command === "LISTSCRIPTS") return ok(['"Veda Mail Rules" ACTIVE']);
      if (command.startsWith("GETSCRIPT")) {
        return ok([], new TextEncoder().encode(content));
      }
      if (command === "CHECKSCRIPT") return ok();
      if (command.startsWith("PUTSCRIPT")) {
        content = new TextDecoder().decode(literal);
        return ok();
      }
      if (command.startsWith("SETACTIVE")) return ok();
      throw new Error("Unexpected command");
    }),
  };
  const client = new ManageSieveClient(config, async () => session);
  return { adapter: new ManageSieveRuleAdapter(client, compiler), commands };
};

describe("ManageSieve GETSCRIPT canonicalization", () => {
  it("removes one signature-verified framing CRLF", async () => {
    const { adapter, commands } = harness(`${canonical}\r\n`);
    const providerState = createHash("sha256")
      .update(canonical, "utf8")
      .digest("base64url");

    await expect(adapter.deploy({ expectedProviderState: providerState, rules: [] }))
      .resolves.toMatchObject({ scriptId: "Veda Mail Rules", status: "deployed" });
    expect(commands).toContain('PUTSCRIPT "Veda Mail Rules"');
  });

  it("does not normalize more than one unverified CRLF", async () => {
    const { adapter, commands } = harness(`${canonical}\r\n\r\n`);

    await expect(adapter.deploy({ expectedProviderState: null, rules: [] }))
      .rejects.toMatchObject({
        code: "RULE_PROVIDER_CONFLICT",
      } satisfies Partial<ManageSieveError>);
    expect(commands.some((command) => command.startsWith("PUTSCRIPT"))).toBe(false);
  });
});
