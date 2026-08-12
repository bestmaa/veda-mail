import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VacationResponseUpdate } from "@/domain/mail/vacation";
import { ManageSieveClient } from "@/infrastructure/providers/imap-smtp/manage-sieve-client";
import { createManageSieveCompiler } from "@/infrastructure/providers/imap-smtp/manage-sieve-compiler";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import type {
  ManageSieveResponse,
  ManageSieveSession,
} from "@/infrastructure/providers/imap-smtp/manage-sieve-transport";
import { ManageSieveVacationAdapter } from "@/infrastructure/providers/imap-smtp/manage-sieve-vacation-adapter";

const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com", imapPort: "993", imapSecurity: "tls",
  manageSieveHost: "sieve.example.com", manageSievePort: "4190",
  manageSieveSecurity: "tls", secret: "secret",
  smtpHost: "smtp.example.com", smtpMaxMessageBytes: "0", smtpPort: "465",
  smtpSecurity: "tls", username: "member@example.com",
};
const ok = (lines: readonly string[] = [], literal: Uint8Array | null = null): ManageSieveResponse =>
  ({ lines, literal, status: "OK" });
const update = (expectedRevision: string): VacationResponseUpdate => ({
  expectedRevision,
  fromDate: "2026-08-12T08:00:00Z",
  htmlBody: "<p>I am away.</p>",
  isEnabled: true,
  subject: "Away",
  textBody: "I am away.",
  toDate: "2026-08-20T08:00:00Z",
});

const harness = (options: {
  active?: string;
  content?: string;
  driftContent?: string;
  sieve?: string;
} = {}) => {
  let active = options.active;
  let content = options.content;
  let drift = false;
  const commands: string[] = [];
  const session: ManageSieveSession = {
    close: vi.fn(async () => undefined),
    command: vi.fn(async (command, literal) => {
      commands.push(command);
      if (command === "CAPABILITY") return ok([
        '"SASL" "PLAIN"',
        `"SIEVE" "${options.sieve ?? "date fileinto relational vacation"}"`,
      ]);
      if (command.startsWith("AUTHENTICATE")) return ok();
      if (command === "LISTSCRIPTS") {
        if (drift && options.driftContent) content = options.driftContent;
        return ok(active ? [`"${active}" ACTIVE`] : content ? ['"Veda Mail Rules"'] : []);
      }
      if (command.startsWith("GETSCRIPT")) return ok([], new TextEncoder().encode(content ?? ""));
      if (command === "CHECKSCRIPT") {
        drift = true;
        return ok();
      }
      if (command.startsWith("PUTSCRIPT")) {
        content = new TextDecoder().decode(literal);
        return ok();
      }
      if (command.startsWith("SETACTIVE")) {
        active = "Veda Mail Rules";
        return ok();
      }
      throw new Error(`Unexpected command ${command}`);
    }),
  };
  const compiler = createManageSieveCompiler({});
  return {
    adapter: new ManageSieveVacationAdapter(
      new ManageSieveClient(config, async () => session),
      compiler,
    ),
    commands,
    content: () => content,
  };
};

beforeEach(() => {
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 8).toString("base64");
});

afterEach(() => {
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
});

describe("ManageSieve vacation adapter", () => {
  it("advertises support only with the safe composition extensions", async () => {
    await expect(harness().adapter.getCapability()).resolves.toEqual({ supported: true });
    await expect(harness({ sieve: "vacation" }).adapter.getCapability()).resolves.toMatchObject({
      supported: false,
    });
  });

  it("returns a disabled empty response without installing a script", async () => {
    const { adapter, commands } = harness();
    await expect(adapter.get()).resolves.toMatchObject({
      isEnabled: false, subject: null,
    });
    expect(commands.some((item) => item.startsWith("PUTSCRIPT"))).toBe(false);
  });

  it("installs, activates, reloads, and disables one owned composite script", async () => {
    const { adapter, commands, content } = harness();
    const initial = await adapter.get();
    const enabled = await adapter.set(update(initial.revision));
    expect(enabled).toMatchObject({ isEnabled: true, subject: "Away" });
    expect(content()).toContain("Veda-Mail-Vacation-v1-Begin");
    await expect(adapter.get()).resolves.toEqual(enabled);

    const disabled = await adapter.set({
      ...update(enabled.revision), fromDate: null, htmlBody: null,
      isEnabled: false, subject: null, textBody: null, toDate: null,
    });
    expect(disabled).toMatchObject({ isEnabled: false, subject: null });
    expect(content()).not.toContain("Veda-Mail-Vacation-v1-Begin");
    expect(commands).toContain("CHECKSCRIPT");
    expect(commands).toContain('PUTSCRIPT "Veda Mail Rules"');
    expect(commands).toContain('SETACTIVE "Veda Mail Rules"');
  });

  it("preserves owned rules while changing vacation metadata", async () => {
    const compiler = createManageSieveCompiler({});
    const rules = compiler.compileRules([], null).content;
    const { adapter, content } = harness({ active: "Veda Mail Rules", content: rules });
    const current = await adapter.get();
    await adapter.set(update(current.revision));
    expect(content()).toContain("# Veda Mail generated rules v1. Do not edit.");
    expect(content()).toContain("Veda-Mail-Vacation-v1-Begin");
  });

  it("rejects stale vacation state, provider drift, and foreign active scripts", async () => {
    await expect(harness().adapter.set(update("stale"))).rejects.toMatchObject({
      code: "VACATION_RESPONSE_CONFLICT",
    });
    const compiler = createManageSieveCompiler({});
    const rules = compiler.compileRules([], null).content;
    const driftContent = compiler.compileVacation(rules, {
      ...update(compiler.readVacation(rules).revision),
      subject: "Provider-side change",
    }).content;
    const drift = harness({ active: "Veda Mail Rules", content: rules, driftContent });
    const current = await drift.adapter.get();
    await expect(drift.adapter.set(update(current.revision))).rejects.toMatchObject({
      code: "VACATION_RESPONSE_CONFLICT",
    });
    await expect(harness({ active: "Vacation" }).adapter.get()).rejects.toMatchObject({
      code: "VACATION_RESPONSE_CONFLICT",
    });
  });
});
