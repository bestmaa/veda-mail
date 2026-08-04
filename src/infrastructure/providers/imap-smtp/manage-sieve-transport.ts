import "server-only";

import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import { lookup } from "node:dns/promises";

import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import {
  assertSafeProviderHost,
  isBlockedProviderAddress,
} from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

const MAX_LINE_BYTES = 8_192;
const MAX_RESPONSE_BYTES = 512 * 1_024;
const TIMEOUT_MS = 15_000;

export interface ManageSieveResponse {
  readonly lines: readonly string[];
  readonly literal: Uint8Array | null;
  readonly status: "BYE" | "NO" | "OK";
}

export interface ManageSieveSession {
  command(command: string, literal?: Uint8Array): Promise<ManageSieveResponse>;
  close(): Promise<void>;
}

class SocketReader {
  private buffer = Buffer.alloc(0);
  private ended = false;
  private readonly waiters: (() => void)[] = [];
  private readonly onData = (chunk: Buffer) => {
    if (this.buffer.byteLength + chunk.byteLength > MAX_RESPONSE_BYTES + MAX_LINE_BYTES) {
      this.socket.destroy(new Error("ManageSieve response is too large."));
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.wake();
  };
  private readonly onEnd = () => { this.ended = true; this.wake(); };

  public constructor(private readonly socket: Socket | TLSSocket) {
    socket.on("data", this.onData);
    socket.on("end", this.onEnd);
    socket.on("close", this.onEnd);
  }

  public async line(): Promise<string> {
    while (true) {
      const end = this.buffer.indexOf("\r\n");
      if (end >= 0) {
        if (end > MAX_LINE_BYTES) throw new Error("ManageSieve response line is too long.");
        const line = this.buffer.subarray(0, end).toString("utf8");
        this.buffer = this.buffer.subarray(end + 2);
        return line;
      }
      if (this.buffer.byteLength > MAX_LINE_BYTES || this.ended) {
        throw new Error("ManageSieve connection ended unexpectedly.");
      }
      await this.more();
    }
  }

  public async exact(size: number): Promise<Uint8Array> {
    if (size < 0 || size > MAX_RESPONSE_BYTES) throw new Error("ManageSieve literal is too large.");
    while (this.buffer.byteLength < size) {
      if (this.ended) throw new Error("ManageSieve connection ended unexpectedly.");
      await this.more();
    }
    const value = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return Uint8Array.from(value);
  }

  public release(): void {
    if (this.buffer.byteLength) throw new Error("Unexpected buffered STARTTLS data.");
    this.socket.off("data", this.onData);
    this.socket.off("end", this.onEnd);
    this.socket.off("close", this.onEnd);
  }

  private more(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private wake(): void {
    this.waiters.splice(0).forEach((resolve) => resolve());
  }
}

class NodeManageSieveSession implements ManageSieveSession {
  public constructor(
    private readonly socket: Socket | TLSSocket,
    private readonly reader: SocketReader,
  ) {}

  public async command(command: string, literal?: Uint8Array) {
    if (/[^\x20-\x7e]/u.test(command)) throw new Error("Invalid ManageSieve command.");
    if (literal && literal.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("ManageSieve command literal is too large.");
    }
    const suffix = literal ? ` {${literal.byteLength}+}\r\n` : "\r\n";
    this.socket.write(command + suffix);
    if (literal) this.socket.write(Buffer.concat([Buffer.from(literal), Buffer.from("\r\n")]));
    return this.response();
  }

  public async greeting() { return this.response(); }

  public async close(): Promise<void> {
    if (!this.socket.destroyed) {
      this.socket.write("LOGOUT\r\n");
      this.socket.destroy();
    }
  }

  private async response(): Promise<ManageSieveResponse> {
    const lines: string[] = [];
    let literal: Uint8Array | null = null;
    let size = 0;
    while (true) {
      const line = await this.reader.line();
      size += Buffer.byteLength(line, "utf8") + 2;
      if (size > MAX_RESPONSE_BYTES) throw new Error("ManageSieve response is too large.");
      const literalMatch = /^\{([0-9]{1,9})\+?\}$/u.exec(line);
      if (literalMatch) {
        if (literal) throw new Error("ManageSieve returned multiple literals.");
        literal = await this.reader.exact(Number(literalMatch[1]));
        size += literal.byteLength;
        continue;
      }
      const status = /^(OK|NO|BYE)(?:\s|$)/iu.exec(line)?.[1]?.toUpperCase();
      if (status) return { lines, literal, status: status as ManageSieveResponse["status"] };
      if (line) lines.push(line);
    }
  }
}

const connected = (socket: Socket | TLSSocket, event: "connect" | "secureConnect") =>
  new Promise<void>((resolve, reject) => {
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("ManageSieve timed out.")));
    socket.once(event, resolve);
    socket.once("error", reject);
  });

const safeAddress = async (host: string) => {
  await assertSafeProviderHost(host);
  const addresses = await lookup(host, { all: true, verbatim: true });
  const localDevelopment = process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "::1"].includes(host.toLowerCase());
  if (!addresses.length || (!localDevelopment &&
    addresses.some(({ address }) => isBlockedProviderAddress(address)))) {
    throw new Error("ManageSieve resolved to an unsafe address.");
  }
  return addresses[0]!;
};

const tlsOptions = (host: string, address: string) => ({
  host: address,
  rejectUnauthorized: true,
  servername: host,
});

export const openManageSieveSession = async (
  config: ImapSmtpMemberConfig,
): Promise<ManageSieveSession> => {
  const host = config.manageSieveHost;
  const port = Number(config.manageSievePort);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("ManageSieve is not configured.");
  }
  const resolved = await safeAddress(host);
  let socket: Socket | TLSSocket;
  if (config.manageSieveSecurity === "tls") {
    socket = connectTls({ ...tlsOptions(host, resolved.address), port });
    await connected(socket, "secureConnect");
  } else if (config.manageSieveSecurity === "starttls") {
    const plain = connectTcp({ host: resolved.address, family: resolved.family, port });
    await connected(plain, "connect");
    const initialReader = new SocketReader(plain);
    const initial = new NodeManageSieveSession(plain, initialReader);
    if ((await initial.greeting()).status !== "OK" ||
      (await initial.command("STARTTLS")).status !== "OK") {
      plain.destroy();
      throw new Error("ManageSieve STARTTLS was rejected.");
    }
    initialReader.release();
    socket = connectTls({ rejectUnauthorized: true, servername: host, socket: plain });
    await connected(socket, "secureConnect");
    const session = new NodeManageSieveSession(socket, new SocketReader(socket));
    if ((await session.command("CAPABILITY")).status !== "OK") throw new Error("ManageSieve discovery failed.");
    return session;
  } else {
    throw new Error("ManageSieve requires TLS or STARTTLS.");
  }
  const session = new NodeManageSieveSession(socket, new SocketReader(socket));
  if ((await session.greeting()).status !== "OK") throw new Error("ManageSieve greeting was rejected.");
  return session;
};
