import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCapability: vi.fn() }));
vi.mock("@/server/snooze/snooze-operation.port", () => ({
  getSnoozeOperationPort: () => ({ getCapability: mocks.getCapability }),
}));

import { id } from "@/domain/shared/brand";
import {
  createSnoozes,
  readSnoozeWorkspace,
} from "@/server/snooze/snooze-service";

const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
const connection = { config: {}, createdAt: "2026-08-04T00:00:00.000Z",
  displayName: "Mail", id: id.connection("missing-key"),
  providerId: id.provider("mock") };

afterEach(() => {
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
});

describe("snooze configuration gate", () => {
  it("returns unsupported reads and rejects writes without touching a provider", async () => {
    delete process.env["VEDA_MAIL_JOB_KEY"];
    await expect(readSnoozeWorkspace(connection)).resolves.toMatchObject({
      book: { messages: [], snoozedMailboxId: null },
      capability: { maxMessages: 0, supported: false },
    });
    await expect(createSnoozes(connection, [])).rejects.toMatchObject({
      code: "SNOOZE_UNAVAILABLE", status: 422,
    });
    expect(mocks.getCapability).not.toHaveBeenCalled();
  });
});
