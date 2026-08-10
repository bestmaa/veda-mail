import { EventEmitter } from "node:events";
import type { TLSSocket } from "node:tls";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ImapSmtpMemberConfig } from
  "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const mocks = vi.hoisted(() => ({
  connectTcp: vi.fn(),
  connectTls: vi.fn(),
  lookup: vi.fn(),
}));

vi.mock("node:net", () => ({
  connect: mocks.connectTcp,
  isIP: (value: string) => value.includes(":") ? 6 : 0,
}));
vi.mock("node:tls", () => ({ connect: mocks.connectTls }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));

import { openManageSieveSession } from
  "@/infrastructure/providers/imap-smtp/manage-sieve-transport";

const config: ImapSmtpMemberConfig = {
  imapHost: "localhost",
  imapPort: "993",
  imapSecurity: "tls",
  manageSieveHost: "localhost",
  manageSievePort: "4190",
  manageSieveSecurity: "tls",
  secret: "not-a-real-secret",
  smtpHost: "localhost",
  smtpMaxMessageBytes: "0",
  smtpPort: "465",
  smtpSecurity: "tls",
  username: "member@example.test",
};

class FakeSocket extends EventEmitter {
  public destroyed = false;
  public readonly writes: Buffer[] = [];

  public constructor(
    private readonly onWrite: (value: Buffer, socket: FakeSocket) => void,
  ) { super(); }

  public destroy(error?: Error): this {
    this.destroyed = true;
    if (error) this.emit("error", error);
    this.emit("close");
    return this;
  }

  public respond(...chunks: string[]): void {
    chunks.forEach((chunk) =>
      queueMicrotask(() => this.emit("data", Buffer.from(chunk, "utf8"))));
  }

  public setTimeout(): this { return this; }

  public write(value: string | Uint8Array): boolean {
    const bytes = Buffer.from(value);
    this.writes.push(bytes);
    this.onWrite(bytes, this);
    return true;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
});

describe("ManageSieve PUTSCRIPT framing", () => {
  it("terminates the stored script before reading its final response", async () => {
    const socket = new FakeSocket((value, current) => {
      if (value.toString() === 'PUTSCRIPT "Veda Mail Rules" {5}\r\n') {
        current.respond("OK Ready for 5 bytes.\r\n");
      }
      if (value.toString() === "keep;\r\n") {
        current.respond("OK script stored\r\n");
      }
      if (value.toString() === "LISTSCRIPTS\r\n") {
        current.respond('"Veda Mail Rules"\r\nOK\r\n');
      }
    });
    mocks.connectTls.mockImplementation(() => {
      queueMicrotask(() => {
        socket.emit("secureConnect");
        queueMicrotask(() => socket.respond("OK\r\n"));
      });
      return socket as unknown as TLSSocket;
    });
    const session = await openManageSieveSession(config);

    await expect(session.command(
      'PUTSCRIPT "Veda Mail Rules"',
      new TextEncoder().encode("keep;"),
      { appendCommandTerminator: true },
    )).resolves.toMatchObject({ status: "OK" });
    await expect(session.command("LISTSCRIPTS")).resolves.toMatchObject({
      lines: ['"Veda Mail Rules"'],
      status: "OK",
    });
    expect(socket.writes.slice(-2).map((item) => item.toString())).toEqual([
      "keep;\r\n",
      "LISTSCRIPTS\r\n",
    ]);
  });
});
