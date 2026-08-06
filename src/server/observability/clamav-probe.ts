import "server-only";

import net from "node:net";

const DEFAULT_PORT = 3310;
const DEFAULT_TIMEOUT_MS = 2_000;

const host = (): string => {
  const value = process.env["VEDA_MAIL_CLAMAV_HOST"] ?? "clamav";
  if (
    value.length < 1 ||
    value.length > 253 ||
    !/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|[A-Fa-f0-9:]+)$/u.test(
      value,
    )
  ) {
    throw new Error("Scanner host is invalid.");
  }
  return value;
};

const port = (): number => {
  const value = Number(
    process.env["VEDA_MAIL_CLAMAV_PORT"] ?? String(DEFAULT_PORT),
  );
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error("Scanner port is invalid.");
  }
  return value;
};

export const probeClamAv = (
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      reject(new Error("Scanner probe timeout is invalid."));
      return;
    }
    const socket = net.createConnection({ host: host(), port: port() });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("Scanner probe timed out.")),
      timeoutMs,
    );
    timer.unref();
    socket.once("connect", () => socket.write(Buffer.from("zPING\0", "ascii")));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const response = Buffer.concat(chunks);
      if (response.byteLength > 16) {
        finish(new Error("Scanner probe returned an invalid response."));
      } else if (response.includes(0)) {
        finish(
          response.equals(Buffer.from("PONG\0", "ascii"))
            ? undefined
            : new Error("Scanner probe returned an invalid response."),
        );
      }
    });
    socket.once("error", () =>
      finish(new Error("Scanner probe is unavailable.")),
    );
    socket.once("close", () =>
      finish(new Error("Scanner probe closed before a verdict.")),
    );
  });
