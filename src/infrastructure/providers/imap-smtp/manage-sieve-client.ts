import "server-only";

import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import {
  openManageSieveSession,
  type ManageSieveResponse,
  type ManageSieveSession,
} from "@/infrastructure/providers/imap-smtp/manage-sieve-transport";

export const VEDA_MANAGE_SIEVE_SCRIPT = "Veda Mail Rules";
export type ManageSieveSessionFactory = (
  config: ImapSmtpMemberConfig,
) => Promise<ManageSieveSession>;

export interface ManageSieveCapabilities {
  readonly extensions: ReadonlySet<string>;
  readonly implementation: string | null;
}

export interface ManageSieveScript {
  readonly active: boolean;
  readonly name: string;
}

const value = (line: string, key: string): string | null => {
  const match = new RegExp(`^"${key}"(?:\\s+"((?:[^"\\\\]|\\\\.)*)")?$`, "iu")
    .exec(line);
  return match ? (match[1] ?? "").replaceAll(/\\(.)/gu, "$1") : null;
};

const requireOk = (response: ManageSieveResponse): void => {
  if (response.status !== "OK") throw new Error("ManageSieve command was rejected.");
};

const quoted = (input: string): string => {
  if (!input || /[\r\n\0]/u.test(input)) throw new Error("Invalid ManageSieve value.");
  return `"${input.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
};

const authenticate = async (
  session: ManageSieveSession,
  config: ImapSmtpMemberConfig,
  lines: readonly string[],
): Promise<void> => {
  const mechanisms = lines.map((line) => value(line, "SASL"))
    .find((item) => item !== null)?.toUpperCase().split(/\s+/u) ?? [];
  if (!mechanisms.includes("PLAIN")) throw new Error("ManageSieve PLAIN authentication is unavailable.");
  const payload = Buffer.from(`\0${config.username}\0${config.secret}`, "utf8").toString("base64");
  requireOk(await session.command(`AUTHENTICATE "PLAIN" "${payload}"`));
};

export class ManageSieveClient {
  public constructor(
    private readonly config: ImapSmtpMemberConfig,
    private readonly factory: ManageSieveSessionFactory = openManageSieveSession,
  ) {}

  public async use<T>(task: (
    session: ManageSieveSession,
    capability: ManageSieveCapabilities,
  ) => Promise<T>): Promise<T> {
    const session = await this.factory(this.config);
    try {
      const discovery = await session.command("CAPABILITY");
      requireOk(discovery);
      await authenticate(session, this.config, discovery.lines);
      const sieve = discovery.lines.map((line) => value(line, "SIEVE"))
        .find((item) => item !== null) ?? "";
      const implementation = discovery.lines.map((line) => value(line, "IMPLEMENTATION"))
        .find((item) => item !== null) ?? null;
      return await task(session, {
        extensions: new Set(sieve.toLowerCase().split(/\s+/u).filter(Boolean)),
        implementation,
      });
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  public async list(session: ManageSieveSession): Promise<readonly ManageSieveScript[]> {
    const response = await session.command("LISTSCRIPTS");
    requireOk(response);
    return response.lines.map((line) => {
      const match = /^"((?:[^"\\]|\\.)*)"(?:\s+(ACTIVE))?$/iu.exec(line);
      if (!match) throw new Error("ManageSieve returned an invalid script list.");
      return {
        active: Boolean(match[2]),
        name: match[1]!.replaceAll(/\\(.)/gu, "$1"),
      };
    });
  }

  public async get(session: ManageSieveSession, name: string): Promise<Uint8Array> {
    const response = await session.command(`GETSCRIPT ${quoted(name)}`);
    requireOk(response);
    if (!response.literal) throw new Error("ManageSieve returned no script content.");
    return response.literal;
  }

  public async check(session: ManageSieveSession, content: Uint8Array): Promise<void> {
    requireOk(await session.command("CHECKSCRIPT", content));
  }

  public async put(session: ManageSieveSession, name: string, content: Uint8Array) {
    requireOk(await session.command(
      `PUTSCRIPT ${quoted(name)}`,
      content,
      { appendCommandTerminator: true },
    ));
  }

  public async activate(session: ManageSieveSession, name: string) {
    requireOk(await session.command(`SETACTIVE ${quoted(name)}`));
  }
}
