import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
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
  isIP: (value: string) => value.includes(":") ? 6 : /^\d+(?:\.\d+){3}$/u.test(value) ? 4 : 0,
}));
vi.mock("node:tls", () => ({ connect: mocks.connectTls }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));

import { openManageSieveSession } from
  "@/infrastructure/providers/imap-smtp/manage-sieve-transport";

const baseConfig: ImapSmtpMemberConfig = {
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
  private timeoutHandler: (() => void) | null = null;

  public constructor(
    private readonly onWrite: (value: Buffer, socket: FakeSocket) => void = () => undefined,
  ) { super(); }

  public destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    if (error) this.emit("error", error);
    this.emit("close");
    return this;
  }

  public fireTimeout(): void { this.timeoutHandler?.(); }

  public respond(...chunks: string[]): void {
    for (const chunk of chunks) {
      queueMicrotask(() => this.emit("data", Buffer.from(chunk, "utf8")));
    }
  }

  public setTimeout(_milliseconds: number, handler: () => void): this {
    this.timeoutHandler = handler;
    return this;
  }

  public write(value: string | Uint8Array): boolean {
    const bytes = Buffer.from(value);
    this.writes.push(bytes);
    this.onWrite(bytes, this);
    return true;
  }
}

const connect = (
  socket: FakeSocket,
  event: "connect" | "secureConnect",
  greeting?: string,
): void => {
  queueMicrotask(() => {
    socket.emit(event);
    if (greeting) queueMicrotask(() => socket.respond(greeting));
  });
};

const asSocket = (socket: FakeSocket): Socket => socket as unknown as Socket;
const asTlsSocket = (socket: FakeSocket): TLSSocket => socket as unknown as TLSSocket;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
});

describe("ManageSieve transport", () => {
  it("parses fragmented lines and a bounded literal over verified TLS", async () => {
    const socket = new FakeSocket((value, current) => {
      if (value.toString() === "GETSCRIPT \"Rules\"\r\n") {
        current.respond("{5}\r\nhe", "llo\r\nOK\r\n");
      }
    });
    mocks.connectTls.mockImplementation(() => {
      connect(socket, "secureConnect", "\"IMPLEMENTATION\" \"test\"\r\nOK\r\n");
      return asTlsSocket(socket);
    });

    const session = await openManageSieveSession(baseConfig);
    const response = await session.command('GETSCRIPT "Rules"');

    expect(response).toMatchObject({ lines: [], status: "OK" });
    expect(Buffer.from(response.literal ?? [])).toEqual(Buffer.from("hello"));
    expect(mocks.connectTls).toHaveBeenCalledWith(expect.objectContaining({
      host: "127.0.0.1",
      rejectUnauthorized: true,
      servername: "localhost",
    }));
    await session.close();
    expect(socket.writes.at(-1)?.toString()).toBe("LOGOUT\r\n");
    expect(socket.destroyed).toBe(true);
  });

  it("frames command literals and rejects command injection", async () => {
    const socket = new FakeSocket((value, current) => {
      if (value.toString() === "CHECKSCRIPT {5}\r\n") {
        current.respond("OK Ready for 5 bytes.\r\n");
      }
      if (value.toString() === "keep;\r\n") current.respond("NO script rejected\r\n");
    });
    mocks.connectTls.mockImplementation(() => {
      connect(socket, "secureConnect", "OK\r\n");
      return asTlsSocket(socket);
    });
    const session = await openManageSieveSession(baseConfig);

    await expect(session.command(
      "CHECKSCRIPT",
      new TextEncoder().encode("keep;"),
    )).resolves.toMatchObject({ status: "NO" });
    expect(socket.writes.slice(-2).map((item) => item.toString())).toEqual([
      "CHECKSCRIPT {5}\r\n",
      "keep;\r\n",
    ]);
    await expect(session.command("NOOP\r\nLOGOUT")).rejects.toThrow(
      "Invalid ManageSieve command",
    );
  });

  it("upgrades STARTTLS before post-TLS capability discovery", async () => {
    const plain = new FakeSocket((value, current) => {
      if (value.toString() === "STARTTLS\r\n") current.respond("OK\r\n");
    });
    const secure = new FakeSocket((value, current) => {
      if (value.toString() === "CAPABILITY\r\n") {
        current.respond("\"SASL\" \"PLAIN\"\r\nOK\r\n");
      }
    });
    mocks.connectTcp.mockImplementation(() => {
      connect(plain, "connect", "\"STARTTLS\"\r\nOK\r\n");
      return asSocket(plain);
    });
    mocks.connectTls.mockImplementation(() => {
      connect(secure, "secureConnect");
      return asTlsSocket(secure);
    });

    const session = await openManageSieveSession({
      ...baseConfig,
      manageSieveSecurity: "starttls",
    });

    expect(plain.writes.map((item) => item.toString())).toContain("STARTTLS\r\n");
    expect(secure.writes.map((item) => item.toString())).toContain("CAPABILITY\r\n");
    expect(mocks.connectTls).toHaveBeenCalledWith(expect.objectContaining({
      rejectUnauthorized: true,
      servername: "localhost",
      socket: plain,
    }));
    await session.close();
  });

  it("preserves timeout failures and destroys the socket", async () => {
    const socket = new FakeSocket();
    mocks.connectTls.mockImplementation(() => {
      connect(socket, "secureConnect");
      return asTlsSocket(socket);
    });

    const opening = openManageSieveSession(baseConfig);
    await vi.waitFor(() => expect(mocks.connectTls).toHaveBeenCalledOnce());
    await Promise.resolve();
    socket.fireTimeout();

    await expect(opening).rejects.toThrow("ManageSieve timed out");
    expect(socket.destroyed).toBe(true);
  });

  it("destroys a TLS socket when its greeting is rejected", async () => {
    const socket = new FakeSocket();
    mocks.connectTls.mockImplementation(() => {
      connect(socket, "secureConnect", "NO unavailable\r\n");
      return asTlsSocket(socket);
    });

    await expect(openManageSieveSession(baseConfig)).rejects.toThrow(
      "ManageSieve greeting was rejected",
    );
    expect(socket.destroyed).toBe(true);
  });

  it.each([
    ["an oversized response line", `${"x".repeat(8_193)}`, "line is too long"],
    ["an oversized literal", "{524289}\r\n", "literal is too large"],
    ["multiple literals", "{1}\r\na\r\n{1}\r\nb\r\nOK\r\n", "multiple literals"],
  ])("rejects %s", async (_label, reply, expected) => {
    const socket = new FakeSocket((value, current) => {
      if (value.toString() === "LISTSCRIPTS\r\n") current.respond(reply);
    });
    mocks.connectTls.mockImplementation(() => {
      connect(socket, "secureConnect", "OK\r\n");
      return asTlsSocket(socket);
    });
    const session = await openManageSieveSession(baseConfig);

    await expect(session.command("LISTSCRIPTS")).rejects.toThrow(expected);
  });

  it("rejects unsafe DNS answers before opening a socket", async () => {
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.8", family: 4 }]);

    await expect(openManageSieveSession({
      ...baseConfig,
      manageSieveHost: "mail.example.com",
    })).rejects.toThrow(/private network|unsafe address/iu);
    expect(mocks.connectTls).not.toHaveBeenCalled();
  });

  it("rejects cleartext configuration before DNS resolution", async () => {
    await expect(openManageSieveSession({
      ...baseConfig,
      manageSieveSecurity: "",
    })).rejects.toThrow("requires TLS or STARTTLS");
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
