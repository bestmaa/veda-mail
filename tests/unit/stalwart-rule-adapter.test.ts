import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuleDeploymentInput } from "@/domain/mail/rule";
import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { StalwartRuleAdapter } from "@/infrastructure/providers/stalwart-jmap/stalwart-rule-adapter";
import type {
  StalwartSieveCompiler,
  StalwartSieveContentPort,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-content";
import {
  JMAP_SIEVE,
  VEDA_RULE_SCRIPT_NAME,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-schema";

const accountId = "primary-account";
const marker = "# Veda ownership hmac=test\r\n";
const input: RuleDeploymentInput = { expectedProviderState: null, rules: [] };

const session = (overrides: Record<string, unknown> = {}) => ({
  accounts: {
    [accountId]: {
      accountCapabilities: {
        [JMAP_SIEVE]: {
          maxNumberRedirects: null,
          maxNumberScripts: 8,
          maxSizeScript: 65_536,
          maxSizeScriptName: 512,
          sieveExtensions: [
            "envelope", "fileinto", "foreverypart", "imap4flags", "mime", "variables",
          ],
        },
      },
      isReadOnly: false,
      name: "member@example.com",
    },
  },
  apiUrl: "https://mail.example.test/jmap",
  capabilities: {
    "urn:ietf:params:jmap:core": { maxSizeUpload: 1_000_000 },
    [JMAP_SIEVE]: { implementation: "Stalwart 1" },
  },
  downloadUrl: "https://mail.example.test/download/{accountId}/{blobId}/{name}",
  primaryAccounts: { [JMAP_MAIL]: accountId, [JMAP_SIEVE]: accountId },
  uploadUrl: "https://mail.example.test/upload/{accountId}",
  username: "member@example.com",
  ...overrides,
});

const response = (method: string, payload: unknown, callId: string) => ({
  methodResponses: [[method, payload, callId] as const],
  sessionState: "session-state",
});

const getResult = (
  list: readonly Record<string, unknown>[],
  state = "state-1",
) => ({ accountId, list, notFound: [], state });

const compiler = (requiredExtensions: readonly string[] = []): StalwartSieveCompiler => ({
  compile: vi.fn(() => ({
    content: `${marker}keep;\r\n`,
    requiredExtensions,
  })),
  verifyOwnership: vi.fn((content: string) => content.startsWith(marker)),
});

const contentPort = (): StalwartSieveContentPort => ({
  download: vi.fn(async () => new TextEncoder().encode(`${marker}keep;\r\n`)),
  upload: vi.fn(async ({ accountId: target, content }) => ({
    accountId: target,
    blobId: "blob-new",
    mediaType: "application/sieve",
    size: content.byteLength,
  })),
});

const client = () => {
  const value = new StalwartJmapClient({
    authType: "basic",
    baseUrl: "https://mail.example.test",
    secret: "secret",
    username: "member@example.com",
  });
  vi.spyOn(value, "getSession").mockResolvedValue(session());
  return value;
};

describe("Stalwart RFC 9661 rule adapter", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("discovers the exact primary account and extension-gated capability", async () => {
    const value = client();
    const adapter = new StalwartRuleAdapter(value, contentPort(), compiler());
    await expect(adapter.getCapability()).resolves.toMatchObject({
      maxRules: 50,
      maxScriptBytes: 65_536,
      supported: true,
      supportedActions: ["discard", "move", "label", "mark-read", "star"],
      supportedConditions: [
        "cc", "from", "header", "size", "subject", "to", "recipient", "attachment",
      ],
    });
  });

  it("does not advertise recipient, attachment, or move without every extension", async () => {
    const value = client();
    const limited = session();
    vi.mocked(value.getSession).mockResolvedValue({
      ...limited,
      accounts: {
        [accountId]: {
          ...limited.accounts[accountId],
          accountCapabilities: {
            [JMAP_SIEVE]: {
              maxNumberRedirects: null,
              maxNumberScripts: 8,
              maxSizeScript: 65_536,
              maxSizeScriptName: 512,
              sieveExtensions: ["foreverypart", "imap4flags", "mime"],
            },
          },
        },
      },
    } as never);
    const capability = await new StalwartRuleAdapter(
      value, contentPort(), compiler(),
    ).getCapability();
    expect(capability.supportedConditions).not.toContain("recipient");
    expect(capability.supportedConditions).not.toContain("attachment");
    expect(capability.supportedActions).not.toContain("move");
    expect(capability.supportedActions).toEqual([
      "discard", "label", "mark-read", "star",
    ]);
  });

  it("validates, CAS-creates, activates, and post-verifies one Veda script", async () => {
    const value = client();
    const request = vi.spyOn(value, "request").mockImplementation(async (calls) => {
      const [method, arguments_, callId] = calls[0]!;
      if (method === "SieveScript/get" && !("ids" in arguments_)) {
        return response(method, getResult([]), callId);
      }
      if (method === "SieveScript/validate") {
        return response(method, { accountId, error: null }, callId);
      }
      if (method === "SieveScript/set") {
        return response(method, {
          accountId,
          created: { veda: { id: "script-1", isActive: true } },
          newState: "state-2",
          notCreated: null,
          notDestroyed: null,
          notUpdated: null,
          oldState: "state-1",
          updated: null,
        }, callId);
      }
      return response(method, getResult([{
        blobId: "blob-new",
        id: "script-1",
        isActive: true,
        name: VEDA_RULE_SCRIPT_NAME,
      }], "state-2"), callId);
    });
    const port = contentPort();
    const result = await new StalwartRuleAdapter(value, port, compiler()).deploy(input);

    expect(result).toMatchObject({
      providerState: "state-2", scriptId: "script-1", status: "deployed",
    });
    expect(result.scriptHash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(request).toHaveBeenNthCalledWith(3, [["SieveScript/set", {
      accountId,
      create: { veda: { blobId: "blob-new", name: VEDA_RULE_SCRIPT_NAME } },
      ifInState: "state-1",
      onSuccessActivateScript: "#veda",
    }, "rules-set"]], [JMAP_SIEVE]);
  });

  it("updates only an HMAC-owned deterministic script under the fetched state", async () => {
    const value = client();
    const owned = {
      blobId: "blob-old", id: "script-1", isActive: true, name: VEDA_RULE_SCRIPT_NAME,
    };
    const request = vi.spyOn(value, "request").mockImplementation(async (calls) => {
      const [method, arguments_, callId] = calls[0]!;
      if (method === "SieveScript/get" && !("ids" in arguments_)) {
        return response(method, getResult([owned]), callId);
      }
      if (method === "SieveScript/validate") {
        return response(method, { accountId, error: null }, callId);
      }
      if (method === "SieveScript/set") {
        return response(method, {
          accountId, created: null, newState: "state-2", notCreated: null,
          notDestroyed: null, notUpdated: null, oldState: "state-1",
          updated: { "script-1": null },
        }, callId);
      }
      return response(method, getResult([{ ...owned, blobId: "blob-new" }], "state-2"), callId);
    });
    await new StalwartRuleAdapter(value, contentPort(), compiler()).deploy(input);

    expect(request).toHaveBeenNthCalledWith(3, [["SieveScript/set", {
      accountId,
      ifInState: "state-1",
      onSuccessActivateScript: "script-1",
      update: { "script-1": { blobId: "blob-new" } },
    }, "rules-set"]], [JMAP_SIEVE]);
  });

  it("recovers a lost activation response when exact owned content is active", async () => {
    const value = client();
    const owned = {
      blobId: "blob-new", id: "script-1", isActive: true,
      name: VEDA_RULE_SCRIPT_NAME,
    };
    vi.spyOn(value, "request").mockImplementation(async (calls) => {
      const [method, , callId] = calls[0]!;
      return response(method, getResult([owned], "state-after-lost-response"), callId);
    });
    const port = contentPort();
    const result = await new StalwartRuleAdapter(
      value, port, compiler(),
    ).deploy({ ...input, expectedProviderState: "state-before" });

    expect(result).toMatchObject({
      providerState: "state-after-lost-response",
      scriptId: "script-1",
      status: "deployed",
    });
    expect(port.upload).not.toHaveBeenCalled();
  });
});
