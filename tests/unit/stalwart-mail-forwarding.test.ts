import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const policyMocks = vi.hoisted(() => ({ assertSafeProviderOrigin: vi.fn() }));
vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: policyMocks.assertSafeProviderOrigin,
}));

import {
  compileStalwartForwardingScript,
  StalwartMailForwardingAdministrator,
  VEDA_FORWARDING_SCRIPT_NAME,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-forwarding-administrator";
import {
  getResult,
  installManagementFetch,
  queryResult,
} from "./stalwart-management-test-support";

const entry = (sourceEmail: string, destinationEmail: string) => ({
  destinationEmail, keepLocalCopy: true as const,
  sourceAddresses: [sourceEmail], sourceEmail,
  status: "active" as const, updatedAt: "2026-08-23T00:00:00.000Z",
});
const administrator = () => new StalwartMailForwardingAdministrator({
  apiKey: "scoped-secret", baseUrl: "https://mail.example.com",
  expectedOrigin: "https://mail.example.com",
});
const originalJobKey = process.env["VEDA_MAIL_JOB_KEY"];

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 17).toString("base64");
});
afterAll(() => {
  if (originalJobKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalJobKey;
});
policyMocks.assertSafeProviderOrigin.mockImplementation(
  async (value: string) => new URL(value),
);

describe("Stalwart admin forwarding", () => {
  it("compiles deterministic keep-copy rules", () => {
    const script = compileStalwartForwardingScript([
      entry("z@example.com", "z@gmail.com"),
      { ...entry("a@example.com", "a@outlook.com"),
        sourceAddresses: ["a@example.com", "alias@example.com"] },
    ]);
    expect(script.indexOf("a@example.com")).toBeLessThan(script.indexOf("z@example.com"));
    expect(script).toContain('require ["copy", "envelope"]');
    expect(script).toContain('redirect :copy "a@outlook.com";');
    expect(script).toContain('if envelope :is "to" "alias@example.com"');
    expect(script).not.toContain("discard");
  });

  it("creates its owned script and safely selects it from a disabled DATA stage", async () => {
    const { calls } = installManagementFetch((call) => {
      if (call.method === "x:MtaStageData/get") {
        return { payload: getResult([{ id: "singleton", script: { else: "false" } }]) };
      }
      if (call.method === "x:SieveSystemScript/query") {
        return { payload: queryResult([]) };
      }
      if (call.method === "x:SieveSystemScript/set") {
        return { payload: { created: { forwarding: { id: "script-1" } } } };
      }
      return { payload: { updated: { singleton: null } } };
    });
    await administrator().apply([entry("a@example.com", "a@gmail.com")]);
    expect(calls.map((call) => call.method)).toEqual([
      "x:MtaStageData/get", "x:SieveSystemScript/query",
      "x:SieveSystemScript/set", "x:MtaStageData/set",
    ]);
    expect(calls[3]?.arguments).toMatchObject({
      update: { singleton: { script: { else: VEDA_FORWARDING_SCRIPT_NAME } } },
    });
  });

  it("updates only an exact owned script and accepts standard null update values", async () => {
    const { calls } = installManagementFetch((call) => {
      if (call.method === "x:MtaStageData/get") {
        return { payload: getResult([{
          id: "singleton", script: { else: VEDA_FORWARDING_SCRIPT_NAME },
        }]) };
      }
      if (call.method === "x:SieveSystemScript/query") {
        return { payload: queryResult(["script-1"]) };
      }
      if (call.method === "x:SieveSystemScript/get") {
        return { payload: getResult([{
          contents: compileStalwartForwardingScript([
            entry("old@example.com", "old@gmail.com"),
          ]),
          description: "Managed by Veda Mail. Do not edit manually.",
          id: "script-1", name: VEDA_FORWARDING_SCRIPT_NAME,
        }]) };
      }
      return { payload: { updated: { "script-1": null } } };
    });
    await administrator().apply([entry("a@example.com", "a@gmail.com")]);
    expect(calls.map((call) => call.method)).toEqual([
      "x:MtaStageData/get", "x:SieveSystemScript/query",
      "x:SieveSystemScript/get", "x:SieveSystemScript/set",
    ]);
  });

  it("fails closed without touching an operator-owned DATA-stage script", async () => {
    const { calls } = installManagementFetch(() => ({
      payload: getResult([{ id: "singleton", script: { else: "operator-script" } }]),
    }));
    await expect(administrator().apply([])).rejects.toThrow("provider-script-conflict");
    expect(calls).toHaveLength(1);
    await expect(administrator().inspect()).resolves.toBe("conflict");
  });

  it("never overwrites an unsigned reserved-name script", async () => {
    const { calls } = installManagementFetch((call) => {
      if (call.method === "x:MtaStageData/get") {
        return { payload: getResult([{ id: "singleton", script: { else: "false" } }]) };
      }
      if (call.method === "x:SieveSystemScript/query") {
        return { payload: queryResult(["operator-script"]) };
      }
      if (call.method === "x:SieveSystemScript/get") {
        return { payload: getResult([{
          contents: "require [\"copy\"];\n# operator-owned",
          description: "Managed by Veda Mail. Do not edit manually.",
          id: "operator-script", name: VEDA_FORWARDING_SCRIPT_NAME,
        }]) };
      }
      throw new Error(`Unexpected mutation ${call.method}`);
    });

    await expect(administrator().apply([])).rejects.toThrow("provider-script-conflict");
    expect(calls.some((call) => call.method.endsWith("/set"))).toBe(false);
  });

  it("reports an unsigned reserved-name script as a read-time conflict", async () => {
    installManagementFetch((call) => {
      if (call.method === "x:MtaStageData/get") {
        return { payload: getResult([{ id: "singleton", script: { else: "false" } }]) };
      }
      if (call.method === "x:SieveSystemScript/query") {
        return { payload: queryResult(["operator-script"]) };
      }
      return { payload: getResult([{
        contents: "# unsigned", description: "operator owned",
        id: "operator-script", name: VEDA_FORWARDING_SCRIPT_NAME,
      }]) };
    });

    await expect(administrator().inspect()).resolves.toBe("conflict");
  });

  it("bounds the compiled provider program before transport", () => {
    expect(() => compileStalwartForwardingScript([
      { ...entry("a@example.com", "a@gmail.com"),
        sourceAddresses: Array.from({ length: 4_000 }, (_, index) =>
          `${"a".repeat(50)}-${index}@example.com`) },
    ])).toThrow(RangeError);
  });
});
