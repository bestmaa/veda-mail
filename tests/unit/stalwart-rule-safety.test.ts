import { describe, expect, it, vi } from "vitest";

import type { RuleDeploymentInput } from "@/domain/mail/rule";
import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { StalwartRuleAdapter } from "@/infrastructure/providers/stalwart-jmap/stalwart-rule-adapter";
import type {
  StalwartSieveCompiler,
  StalwartSieveContentPort,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-content";
import { JMAP_SIEVE, VEDA_RULE_SCRIPT_NAME } from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-schema";

const accountId = "account-a";
const input: RuleDeploymentInput = { expectedProviderState: null, rules: [] };
const compiler = (extensions: readonly string[] = []): StalwartSieveCompiler => ({
  compile: vi.fn(() => ({ content: "# owned\r\nkeep;\r\n", requiredExtensions: extensions })),
  verifyOwnership: vi.fn((content: string) => content.startsWith("# owned")),
});
const port = (download = "# owned\r\nkeep;\r\n"): StalwartSieveContentPort => ({
  download: vi.fn(async () => new TextEncoder().encode(download)),
  upload: vi.fn(async ({ content }) => ({
    accountId, blobId: "blob-new", mediaType: "application/sieve", size: content.byteLength,
  })),
});
const session = (extensions: readonly string[] = ["imap4flags"]) => ({
  accounts: { [accountId]: {
    accountCapabilities: { [JMAP_SIEVE]: {
      maxNumberRedirects: null, maxNumberScripts: 5, maxSizeScript: 65_536,
      maxSizeScriptName: 512, sieveExtensions: extensions,
    } },
    isReadOnly: false, name: "member@example.com",
  } },
  apiUrl: "https://mail.test/jmap",
  capabilities: {
    "urn:ietf:params:jmap:core": { maxSizeUpload: 1_000_000 },
    [JMAP_SIEVE]: { implementation: "Stalwart" },
  },
  downloadUrl: "https://mail.test/download", primaryAccounts: {
    [JMAP_MAIL]: accountId, [JMAP_SIEVE]: accountId,
  },
  uploadUrl: "https://mail.test/upload", username: "member@example.com",
});
const setup = (list: readonly Record<string, unknown>[], extensions?: readonly string[]) => {
  const client = new StalwartJmapClient({
    authType: "basic", baseUrl: "https://mail.test", secret: "x", username: "member@example.com",
  });
  vi.spyOn(client, "getSession").mockResolvedValue(session(extensions));
  const request = vi.spyOn(client, "request").mockResolvedValue({
    methodResponses: [["SieveScript/get", {
      accountId, list, notFound: [], state: "state-1",
    }, "rules-get"]],
    sessionState: "session",
  });
  return { client, request };
};

describe("Stalwart rule deployment safety", () => {
  it("never overwrites or deactivates a foreign active or vacation script", async () => {
    const current = setup([{
      blobId: "vacation", id: "vacation-script", isActive: true, name: "Vacation",
    }]);
    const content = port();
    await expect(new StalwartRuleAdapter(
      current.client, content, compiler(),
    ).deploy(input)).rejects.toMatchObject({ code: "RULE_PROVIDER_CONFLICT" });
    expect(content.upload).not.toHaveBeenCalled();
    expect(current.request).toHaveBeenCalledOnce();
  });

  it("rejects a deterministic-name collision without the exact ownership marker", async () => {
    const current = setup([{
      blobId: "foreign", id: "foreign-script", isActive: false, name: VEDA_RULE_SCRIPT_NAME,
    }]);
    const content = port("# foreign script\r\nkeep;\r\n");
    await expect(new StalwartRuleAdapter(
      current.client, content, compiler(),
    ).deploy(input)).rejects.toMatchObject({ code: "RULE_PROVIDER_CONFLICT" });
    expect(content.download).toHaveBeenCalledWith({
      accountId, blobId: "foreign", maxBytes: 65_536,
    });
    expect(content.upload).not.toHaveBeenCalled();
  });

  it("fails before upload when compiled rules require an unadvertised extension", async () => {
    const current = setup([], ["imap4flags"]);
    const content = port();
    await expect(new StalwartRuleAdapter(
      current.client, content, compiler(["fileinto"]),
    ).deploy(input)).rejects.toMatchObject({ code: "RULE_PROVIDER_UNSUPPORTED" });
    expect(content.upload).not.toHaveBeenCalled();
  });

  it("reports unsupported when Sieve is not the exact primary mail account", async () => {
    const current = setup([]);
    vi.mocked(current.client.getSession).mockResolvedValue({
      ...session(),
      primaryAccounts: { [JMAP_MAIL]: accountId, [JMAP_SIEVE]: "other" },
    });
    await expect(new StalwartRuleAdapter(
      current.client, port(), compiler(),
    ).getCapability()).resolves.toMatchObject({ supported: false });
    expect(current.request).not.toHaveBeenCalled();
  });

  it("sanitizes provider validation diagnostics and never installs invalid Sieve", async () => {
    const current = setup([]);
    current.request.mockImplementation(async (calls) => {
      const [method, , callId] = calls[0]!;
      return method === "SieveScript/get"
        ? {
            methodResponses: [[method, {
              accountId, list: [], notFound: [], state: "state-1",
            }, callId]],
            sessionState: "session",
          }
        : {
            methodResponses: [[method, {
              accountId,
              error: { description: "secret upstream parser detail", type: "invalidSieve" },
            }, callId]],
            sessionState: "session",
          };
    });
    let failure: unknown;
    try {
      await new StalwartRuleAdapter(current.client, port(), compiler()).deploy(input);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "RULE_PROVIDER_REJECTED" });
    expect(String(failure)).not.toContain("secret upstream parser detail");
    expect(current.request.mock.calls.map(([calls]) => calls[0]?.[0])).toEqual([
      "SieveScript/get", "SieveScript/validate",
    ]);
  });

  it("maps an ifInState race to a reload conflict without retrying", async () => {
    const current = setup([]);
    current.request.mockImplementation(async (calls) => {
      const [method, , callId] = calls[0]!;
      if (method === "SieveScript/get") {
        return {
          methodResponses: [[method, {
            accountId, list: [], notFound: [], state: "state-1",
          }, callId]],
          sessionState: "session",
        };
      }
      if (method === "SieveScript/validate") {
        return {
          methodResponses: [[method, { accountId, error: null }, callId]],
          sessionState: "session",
        };
      }
      return {
        methodResponses: [["error", { type: "stateMismatch" }, callId]],
        sessionState: "session",
      };
    });
    await expect(new StalwartRuleAdapter(
      current.client, port(), compiler(),
    ).deploy(input)).rejects.toMatchObject({ code: "RULE_PROVIDER_CONFLICT" });
    expect(current.request).toHaveBeenCalledTimes(3);
  });
});
