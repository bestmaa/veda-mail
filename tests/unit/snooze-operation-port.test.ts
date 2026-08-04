import { afterEach, describe, expect, it, vi } from "vitest";

const clearInstalledPort = (): void => {
  delete (globalThis as typeof globalThis & {
    __vedaMailSnoozeOperationPort?: unknown;
  }).__vedaMailSnoozeOperationPort;
};

afterEach(() => {
  clearInstalledPort();
  vi.resetModules();
});

describe("snooze operation port registry", () => {
  it("survives separate server bundle module instances", async () => {
    const first = await import("@/server/snooze/snooze-operation.port");
    const port = {
      getAccountScope: vi.fn(),
      getCapability: vi.fn(),
      hide: vi.fn(),
      inspect: vi.fn(),
      mailboxIntent: vi.fn(),
      preflight: vi.fn(),
      restore: vi.fn(),
    };
    first.installSnoozeOperationPort(port);

    vi.resetModules();
    const second = await import("@/server/snooze/snooze-operation.port");

    expect(second.getSnoozeOperationPort()).toBe(port);
  });
});
