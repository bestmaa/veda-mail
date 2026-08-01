import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AttachmentScanContext } from "@/server/attachments";
import { ClamAvAttachmentScanner } from "@/server/security/attachment-inspection";

const servers: net.Server[] = [];

const emptyContent = async function* () {
  yield Buffer.from("safe");
};

const context = (
  controller: AbortController,
  abortUpload = vi.fn(),
): AttachmentScanContext => ({
  abortUpload,
  attachmentId: "deadline-test",
  expectedBytes: 4,
  signal: controller.signal,
});

const silentClamd = async (): Promise<number> => {
  const server = net.createServer((socket) => {
    socket.on("data", () => undefined);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  return address.port;
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("ClamAV scan deadlines", () => {
  it("does not open a socket when the request is already aborted", async () => {
    const createConnection = vi.spyOn(net, "createConnection");
    const controller = new AbortController();
    const abortUpload = vi.fn();
    controller.abort();
    const scanner = new ClamAvAttachmentScanner();

    await expect(
      scanner.scan(emptyContent(), context(controller, abortUpload)),
    ).rejects.toThrow("cancelled");
    expect(createConnection).not.toHaveBeenCalled();
    expect(abortUpload).toHaveBeenCalledOnce();
  });

  it("enforces an explicit connection deadline", async () => {
    const socket = new net.Socket();
    vi.spyOn(net, "createConnection").mockReturnValue(socket);
    const controller = new AbortController();
    const abortUpload = vi.fn();
    const scanner = new ClamAvAttachmentScanner({
      absoluteTimeoutMs: 1_000,
      connectTimeoutMs: 20,
      host: "127.0.0.1",
      idleTimeoutMs: 1_000,
      port: 3310,
      verdictTimeoutMs: 1_000,
    });

    await expect(
      scanner.scan(emptyContent(), context(controller, abortUpload)),
    ).rejects.toThrow("timed out");
    expect(abortUpload).toHaveBeenCalled();
    expect(socket.destroyed).toBe(true);
  });

  it("enforces an absolute deadline even while the stream progresses", async () => {
    const port = await silentClamd();
    const controller = new AbortController();
    const abortUpload = vi.fn();
    const scanner = new ClamAvAttachmentScanner({
      absoluteTimeoutMs: 35,
      connectTimeoutMs: 1_000,
      host: "127.0.0.1",
      idleTimeoutMs: 1_000,
      port,
      verdictTimeoutMs: 1_000,
    });
    const slowContent = async function* () {
      for (let index = 0; index < 10; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield Buffer.from("x");
      }
    };

    await expect(
      scanner.scan(slowContent(), context(controller, abortUpload)),
    ).rejects.toThrow("timed out");
    expect(abortUpload).toHaveBeenCalled();
  });

  it("sanitizes transport errors before they cross the scanner boundary", async () => {
    const socket = new net.Socket();
    vi.spyOn(net, "createConnection").mockImplementation(() => {
      queueMicrotask(() => socket.emit("error", new Error("10.0.0.7 secret")));
      return socket;
    });
    const controller = new AbortController();
    const scanner = new ClamAvAttachmentScanner({
      absoluteTimeoutMs: 1_000,
      connectTimeoutMs: 1_000,
      host: "127.0.0.1",
      idleTimeoutMs: 1_000,
      port: 3310,
      verdictTimeoutMs: 1_000,
    });

    await expect(
      scanner.scan(emptyContent(), context(controller)),
    ).rejects.toThrow("Attachment scanner is unavailable.");
  });
});
