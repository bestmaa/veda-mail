import "server-only";

import net from "node:net";

import type {
  AttachmentScanContext,
  AttachmentScanResult,
  AttachmentScanner,
} from "@/server/attachments";

export { MagicNumberMimeDetector } from "./attachment-mime-inspection";

const CLAMAV_PORT = 3310;
const CONNECT_TIMEOUT_MS = 10_000;
const SCAN_ABSOLUTE_TIMEOUT_MS = 5 * 60_000;
const SCAN_IDLE_TIMEOUT_MS = 30_000;
const VERDICT_TIMEOUT_MS = 30_000;
const MAX_CLAMAV_RESPONSE_BYTES = 4_096;
class ScanFailure extends Error {}
const timeoutFailure = () => new ScanFailure("Attachment scan timed out.");
const invalidVerdictFailure = () =>
  new ScanFailure("Attachment scanner returned an invalid verdict.");
const abortedFailure = () =>
  new ScanFailure("Attachment scanning was cancelled.");

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
  readonly absoluteTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly host?: string;
  readonly idleTimeoutMs?: number;
  readonly port?: number;
  readonly verdictTimeoutMs?: number;
}
const validTimeout = (value: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Attachment scan timeout is invalid.");
  }
  return value;
};
const waitForSocketConnection = (
  socket: net.Socket,
  timeoutMs: number,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(timeoutFailure());
      socket.destroy();
    }, timeoutMs);
    timer.unref();
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
const writeSocket = (socket: net.Socket, data: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    if (socket.destroyed || !socket.writable) {
      reject(new Error("Scanner connection closed."));
      return;
    }
    const onError = (error: Error) => reject(error);
    const onWrite = (error?: Error | null) => {
      socket.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    socket.once("error", onError);
    try {
      socket.write(data, onWrite);
    } catch (error) {
      socket.off("error", onError);
      reject(error);
    }
  });
const readClamAvResponse = (
  socket: net.Socket,
  timeoutMs: number,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("close", onClose);
      socket.off("data", onData);
      socket.off("end", onClose);
      socket.off("error", onError);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onClose = () => fail(invalidVerdictFailure());
    const onError = (error: Error) => fail(error);
    const onData = (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_CLAMAV_RESPONSE_BYTES) {
        fail(invalidVerdictFailure());
        socket.destroy();
        return;
      }
      chunks.push(chunk);
      const response = Buffer.concat(chunks);
      const terminator = response.indexOf(0);
      if (terminator < 0) return;
      const verdict = response.subarray(0, terminator);
      if (
        terminator !== response.byteLength - 1 ||
        verdict.includes(10) ||
        verdict.includes(13)
      ) {
        fail(invalidVerdictFailure());
        return;
      }
      settled = true;
      cleanup();
      resolve(verdict.toString("utf8"));
    };
    const timer = setTimeout(() => {
      fail(timeoutFailure());
      socket.destroy();
    }, timeoutMs);
    timer.unref();
    socket.once("close", onClose);
    socket.on("data", onData);
    socket.once("end", onClose);
    socket.once("error", onError);
  });
export class ClamAvAttachmentScanner implements AttachmentScanner {
  public constructor(private readonly options: ClamAvScannerOptions = {}) {}

  public async scan(
    content: AsyncIterable<Uint8Array>,
    context?: AttachmentScanContext,
  ): Promise<AttachmentScanResult> {
    const absoluteTimeoutMs = validTimeout(
      this.options.absoluteTimeoutMs ?? SCAN_ABSOLUTE_TIMEOUT_MS,
    );
    const connectTimeoutMs = validTimeout(
      this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
    );
    const idleTimeoutMs = validTimeout(
      this.options.idleTimeoutMs ?? SCAN_IDLE_TIMEOUT_MS,
    );
    const verdictTimeoutMs = validTimeout(
      this.options.verdictTimeoutMs ?? VERDICT_TIMEOUT_MS,
    );
    const abortUpload = () => {
      try {
        context?.abortUpload();
      } catch {
        // Cleanup callbacks must not replace the sanitized scan failure.
      }
    };
    if (context?.signal.aborted) {
      abortUpload();
      throw abortedFailure();
    }

    const socket = net.createConnection({
      host: this.options.host ?? clamAvHost(),
      port: this.options.port ?? clamAvPort(),
    });
    let interrupted = false;
    let rejectInterruption: (error: Error) => void = () => undefined;
    const interruption = new Promise<never>((_resolve, reject) => {
      rejectInterruption = reject;
    });
    const interrupt = (error: Error) => {
      if (interrupted) return;
      interrupted = true;
      abortUpload();
      rejectInterruption(error);
      socket.destroy();
    };
    const onAbort = () => interrupt(abortedFailure());
    const absoluteTimer = setTimeout(
      () => interrupt(timeoutFailure()),
      absoluteTimeoutMs,
    );
    absoluteTimer.unref();
    socket.setTimeout(idleTimeoutMs, () => interrupt(timeoutFailure()));
    context?.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const operation = async (): Promise<AttachmentScanResult> => {
        await waitForSocketConnection(socket, connectTimeoutMs);
        await writeSocket(socket, Buffer.from("zINSTREAM\0", "ascii"));
        for await (const chunk of content) {
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.byteLength);
          await writeSocket(socket, length);
          await writeSocket(socket, chunk);
        }
        await writeSocket(socket, Buffer.alloc(4));
        const response = await readClamAvResponse(socket, verdictTimeoutMs);
        if (response === "stream: OK") return { verdict: "clean" };
        if (/^stream: [^\r\n\0]{1,2048} FOUND$/u.test(response)) {
          return { reason: "Malware signature detected.", verdict: "infected" };
        }
        throw invalidVerdictFailure();
      };
      return await Promise.race([operation(), interruption]);
    } catch (error) {
      abortUpload();
      if (error instanceof ScanFailure) throw error;
      throw new ScanFailure("Attachment scanner is unavailable.");
    } finally {
      clearTimeout(absoluteTimer);
      context?.signal.removeEventListener("abort", onAbort);
      socket.destroy();
    }
  }
}
