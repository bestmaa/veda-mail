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
const content = `${marker}keep;\r\n`;

const session = () => ({
  accounts: { [accountId]: { accountCapabilities: { [JMAP_SIEVE]: {
    maxNumberRedirects: null, maxNumberScripts: 8, maxSizeScript: 65_536,
    maxSizeScriptName: 512, sieveExtensions: [],
  } }, isReadOnly: false, name: "member@example.com" } },
  apiUrl: "https://mail.example.test/jmap",
  capabilities: {
    "urn:ietf:params:jmap:core": { maxSizeUpload: 1_000_000 },
    [JMAP_SIEVE]: { implementation: "Stalwart 1" },
  },
  downloadUrl: "https://mail.example.test/download/{accountId}/{blobId}/{name}",
  primaryAccounts: { [JMAP_MAIL]: accountId, [JMAP_SIEVE]: accountId },
  uploadUrl: "https://mail.example.test/upload/{accountId}",
  username: "member@example.com",
});

const response = (method: string, payload: unknown, callId: string) => ({
  methodResponses: [[method, payload, callId] as const],
  sessionState: "session-state",
});

const compiler = (): StalwartSieveCompiler => ({
  compile: vi.fn(() => ({ content, requiredExtensions: [] })),
  verifyOwnership: vi.fn((value: string) => value.startsWith(marker)),
});

const port = (installedContent = content): StalwartSieveContentPort => ({
  download: vi.fn(async () => new TextEncoder().encode(installedContent)),
  upload: vi.fn(async ({ accountId: target, content: bytes }) => ({
    accountId: target, blobId: "blob-upload", mediaType: "application/sieve",
    size: bytes.byteLength,
  })),
});

const client = () => {
  const value = new StalwartJmapClient({
    authType: "basic", baseUrl: "https://mail.example.test",
    secret: "secret", username: "member@example.com",
  });
  vi.spyOn(value, "getSession").mockResolvedValue(session());
  vi.spyOn(value, "request").mockImplementation(async (calls) => {
    const [method, arguments_, callId] = calls[0]!;
    if (method === "SieveScript/get" && !("ids" in arguments_)) {
      return response(method, {
        accountId, list: [], notFound: [], state: "state-1",
      }, callId);
    }
    if (method === "SieveScript/validate") {
      return response(method, { accountId, error: null }, callId);
    }
    if (method === "SieveScript/set") {
      return response(method, {
        accountId, created: { veda: { id: "script-1", isActive: true } },
        newState: "state-2", oldState: "state-1",
      }, callId);
    }
    return response(method, {
      accountId,
      list: [{ blobId: "blob-canonical", id: "script-1", isActive: true,
        name: VEDA_RULE_SCRIPT_NAME }],
      notFound: [], state: "state-2",
    }, callId);
  });
  return value;
};

describe("Stalwart canonical Sieve blobs", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("accepts a canonical blob only after exact content verification", async () => {
    const contentPort = port();
    await expect(
      new StalwartRuleAdapter(client(), contentPort, compiler()).deploy(input),
    ).resolves.toMatchObject({ scriptId: "script-1", status: "deployed" });
    expect(contentPort.download).toHaveBeenCalledWith({
      accountId, blobId: "blob-canonical", maxBytes: 65_536,
    });
  });

  it("rejects a canonical blob when installed content differs", async () => {
    await expect(new StalwartRuleAdapter(
      client(), port(`${marker}discard;\r\n`), compiler(),
    ).deploy(input)).rejects.toMatchObject({ code: "RULE_PROVIDER_REJECTED" });
  });
});
