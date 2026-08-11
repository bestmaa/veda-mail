import { describe, expect, it } from "vitest";

import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import {
  openManageSieveSession,
  type ManageSieveResponse,
} from "@/infrastructure/providers/imap-smtp/manage-sieve-transport";

const username = process.env["VEDA_MAIL_TEST_MANAGESIEVE_USERNAME"];
const password = process.env["VEDA_MAIL_TEST_MANAGESIEVE_PASSWORD"];
const host = process.env["VEDA_MAIL_TEST_MANAGESIEVE_HOST"];
const enabled = Boolean(host && username && password);
const liveTest = enabled ? it : it.skip;
const SCRIPT_NAME = "Veda Mail Live Probe";
const SCRIPT = new TextEncoder().encode([
  "# Veda Mail isolated live protocol probe",
  'require ["imap4flags"];',
  'if header :contains "subject" "veda-live-probe" {',
  '  addflag "\\\\Seen";',
  "}",
  "",
].join("\r\n"));

const quoted = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const requireOk = (phase: string, response: ManageSieveResponse): void => {
  if (response.status !== "OK") {
    const detail = response.lines.join(" ").replaceAll(/[^\x20-\x7e]/gu, "?").slice(0, 256);
    throw new Error(`ManageSieve ${phase} failed (${response.status}): ${detail}`);
  }
};

describe("live ManageSieve protocol", () => {
  liveTest("uploads, activates, reads, and removes an isolated script", async () => {
    expect(username).toMatch(/^veda-accept-[a-z0-9-]+@[^@\s]+$/u);
    const config: ImapSmtpMemberConfig = {
      imapHost: host!,
      imapPort: "993",
      imapSecurity: "tls",
      manageSieveHost: host!,
      manageSievePort: "4190",
      manageSieveSecurity: "starttls",
      secret: password!,
      smtpHost: host!,
      smtpMaxMessageBytes: "0",
      smtpPort: "465",
      smtpSecurity: "tls",
      username: username!,
    };
    const step = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown failure";
        throw new Error(`ManageSieve ${name}: ${message}`, { cause: error });
      }
    };
    const session = await step("connect", () => openManageSieveSession(config));
    let uploadAttempted = false;
    try {
      const capability = await step("CAPABILITY", () => session.command("CAPABILITY"));
      requireOk("CAPABILITY", capability);
      expect(capability.lines.join(" ").toLowerCase()).toContain("imap4flags");
      const auth = Buffer.from(`\0${username}\0${password}`, "utf8").toString("base64");
      requireOk("AUTHENTICATE", await step(
        "AUTHENTICATE",
        () => session.command(`AUTHENTICATE "PLAIN" "${auth}"`),
      ));
      const initial = await step("LISTSCRIPTS preflight", () => session.command("LISTSCRIPTS"));
      requireOk("LISTSCRIPTS preflight", initial);
      expect(initial.lines).toEqual([]);
      requireOk("CHECKSCRIPT", await step(
        "CHECKSCRIPT",
        () => session.command(
          "CHECKSCRIPT",
          SCRIPT,
          { appendCommandTerminator: true },
        ),
      ));
      uploadAttempted = true;
      requireOk(
        "PUTSCRIPT",
        await step(
          "PUTSCRIPT",
          () => session.command(
            `PUTSCRIPT ${quoted(SCRIPT_NAME)}`,
            SCRIPT,
            { appendCommandTerminator: true },
          ),
        ),
      );
      requireOk("SETACTIVE", await step(
        "SETACTIVE",
        () => session.command(`SETACTIVE ${quoted(SCRIPT_NAME)}`),
      ));
      const active = await step("LISTSCRIPTS active", () => session.command("LISTSCRIPTS"));
      requireOk("LISTSCRIPTS active", active);
      expect(active.lines).toContain(`${quoted(SCRIPT_NAME)} ACTIVE`);
      const stored = await step(
        "GETSCRIPT",
        () => session.command(`GETSCRIPT ${quoted(SCRIPT_NAME)}`),
      );
      requireOk("GETSCRIPT", stored);
      expect(stored.literal).toEqual(SCRIPT);
    } finally {
      if (uploadAttempted) {
        await session.command('SETACTIVE ""').catch(() => undefined);
        await session.command(`DELETESCRIPT ${quoted(SCRIPT_NAME)}`).catch(() => undefined);
      }
      await session.close().catch(() => undefined);
    }
  }, 30_000);
});
