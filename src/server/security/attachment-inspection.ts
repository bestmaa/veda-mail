import "server-only";

import net from "node:net";

import type {
  AttachmentScanContext,
  AttachmentScanResult,
  AttachmentScanner,
} from "@/server/attachments";

export { MagicNumberMimeDetector } from "./attachment-mime-inspection";

const CLAMAV_PORT = 3310;
const SCAN_IDLE_TIMEOUT_MS = 30_000;
const VERDICT_TIMEOUT_MS = 30_000;
const MAX_CLAMAV_RESPONSE_BYTES = 4_096;

const clamAvHost = (): string => {
  const host = process.env["VEDA_MAIL_CLAMAV_HOST"] ?? "clamav";
  if (
    host.length < 1 ||
    host.length > 253 ||
    !/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|[A-Fa-f0-9:]+)$/u.test(host)
  ) {
    throw new Error("VEDA_MAIL_CLAMAV_HOST is invalid.");
  }
  return host;
};

const clamAvPort = (): number => {
  const raw = process.env["VEDA_MAIL_CLAMAV_PORT"] ?? String(CLAMAV_PORT);
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("VEDA_MAIL_CLAMAV_PORT is invalid.");
  }
  return port;
};

interface ClamAvScannerOptions {
  readonly host?: string;
  readonly idleTimeoutMs?: number;
  readonly port?: number;
  readonly verdictTimeoutMs?: number;
}

const waitForSocketConnection = (socket: net.Socket): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = () => socket.off("error", onError);
    const onError = (error: Error) => {
      socket.off("connect", onConnect);
      reject(error);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });

const writeSocket = (socket: net.Socket, data: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    if (socket.destroyed || !socket.writable) {
      reject(new Error("ClamAV scanner connection closed."));
      return;
    }
    const cleanup = () => socket.off("error", onError);
    const onError = (error: Error) => {
      reject(error);
    };
    const onWrite = (error?: Error | null) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    socket.once("error", onError);
    try {
      socket.write(data, onWrite);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });

const readClamAvResponse = (
  socket: net.Socket,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.off("close", onClose);
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new Error("ClamAV scan was aborted."));
    const onClose = () =>
      fail(new Error("ClamAV closed before returning a complete verdict."));
    const onEnd = () =>
      fail(new Error("ClamAV ended before returning a complete verdict."));
    const onError = (error: Error) => fail(error);
    const onData = (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_CLAMAV_RESPONSE_BYTES) {
        fail(new Error("ClamAV returned an oversized response."));
        socket.destroy();
        return;
      }
      chunks.push(chunk);
      const response = Buffer.concat(chunks);
      const terminator = response.indexOf(0);
      if (terminator < 0) return;
      if (
        terminator !== response.byteLength - 1 ||
        response.subarray(0, terminator).includes(10) ||
        response.subarray(0, terminator).includes(13)
      ) {
        fail(new Error("ClamAV returned a malformed verdict."));
        return;
      }
      settled = true;
      cleanup();
      resolve(response.subarray(0, terminator).toString("utf8"));
    };
    const timer = setTimeout(() => {
      fail(new Error("ClamAV verdict timed out."));
      socket.destroy();
    }, timeoutMs);
    timer.unref();
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("close", onClose);
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
  });

export class ClamAvAttachmentScanner implements AttachmentScanner {
  public constructor(private readonly options: ClamAvScannerOptions = {}) {}

  public async scan(
    content: AsyncIterable<Uint8Array>,
    context?: AttachmentScanContext,
  ): Promise<AttachmentScanResult> {
    const idleTimeoutMs = this.options.idleTimeoutMs ?? SCAN_IDLE_TIMEOUT_MS;
    const verdictTimeoutMs =
      this.options.verdictTimeoutMs ?? VERDICT_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(idleTimeoutMs) ||
      idleTimeoutMs <= 0 ||
      !Number.isSafeInteger(verdictTimeoutMs) ||
      verdictTimeoutMs <= 0
    ) {
      throw new Error("ClamAV scan timeout is invalid.");
    }
    const socket = net.createConnection({
      host: this.options.host ?? clamAvHost(),
      port: this.options.port ?? clamAvPort(),
    });
    let rejectInterruption: (error: Error) => void = () => undefined;
    const interruption = new Promise<never>((_resolve, reject) => {
      rejectInterruption = reject;
    });
    const interrupt = (message: string) => {
      context?.abortUpload();
      rejectInterruption(new Error(message));
      socket.destroy();
    };
    const onAbort = () => {
      rejectInterruption(new Error("ClamAV scan was aborted."));
      socket.destroy();
    };
    socket.setTimeout(idleTimeoutMs, () => {
      interrupt("ClamAV scan was idle for too long.");
    });
    context?.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const operation = async (): Promise<AttachmentScanResult> => {
        await waitForSocketConnection(socket);
        await writeSocket(socket, Buffer.from("zINSTREAM\0", "ascii"));
        for await (const chunk of content) {
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.byteLength);
          await writeSocket(socket, length);
          await writeSocket(socket, chunk);
        }
        await writeSocket(socket, Buffer.alloc(4));
        const response = await readClamAvResponse(
          socket,
          verdictTimeoutMs,
          context?.signal,
        );
        if (response === "stream: OK") return { verdict: "clean" };
        if (/^stream: [^\r\n\0]{1,2048} FOUND$/u.test(response)) {
          return { reason: "Malware signature detected.", verdict: "infected" };
        }
        throw new Error("ClamAV did not return a clean or infected verdict.");
      };
      return await Promise.race([operation(), interruption]);
    } finally {
      context?.signal.removeEventListener("abort", onAbort);
      socket.destroy();
    }
  }
}
