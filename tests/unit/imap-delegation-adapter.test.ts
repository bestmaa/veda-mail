import type { ImapFlow } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const mocks = vi.hoisted(() => ({ client: null as unknown as ImapFlow }));
vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (
    _config: unknown,
    task: (client: ImapFlow) => Promise<unknown>,
  ) => task(mocks.client),
}));

import { ImapDelegationAdapter } from "@/infrastructure/providers/imap-smtp/imap-delegation-adapter";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com", imapPort: "993", imapSecurity: "tls",
  secret: "secret", smtpHost: "smtp.example.com", smtpMaxMessageBytes: "26214400",
  smtpPort: "465", smtpSecurity: "tls", username: "owner@example.com",
};

const harness = (
  acl = new Map<string, string>(),
  rewriteRights: (rights: string) => string = (rights) => rights,
) => {
  const next = vi.fn();
  const exec = vi.fn(async (
    command: string,
    attributes: readonly { readonly value: string }[],
    options?: { readonly untagged?: Readonly<Record<string, (value: unknown) => void>> },
  ) => {
    if (command === "GETACL") {
      options?.untagged?.["ACL"]?.({ attributes: [
        { value: "INBOX" },
        ...[...acl].flatMap(([identifier, rights]) => [{ value: identifier }, { value: rights }]),
      ] });
    } else if (command === "SETACL") {
      acl.set(attributes[1]!.value, rewriteRights(attributes[2]!.value));
    } else if (command === "DELETEACL") {
      acl.delete(attributes[1]!.value);
    }
    return { next };
  });
  const client = { capabilities: new Map([["ACL", true]]), exec };
  mocks.client = client as unknown as ImapFlow;
  return { acl, client, exec, next };
};

beforeEach(() => vi.clearAllMocks());

describe("IMAP delegation adapter", () => {
  it("only advertises delegation when the provider reports RFC 4314 ACL", async () => {
    const supported = harness();
    const adapter = new ImapDelegationAdapter(config);
    await expect(adapter.getCapability()).resolves.toEqual({ mailbox: "INBOX", supported: true });
    supported.client.capabilities.clear();
    await expect(adapter.getCapability()).resolves.toMatchObject({ supported: false });
    await expect(adapter.list()).rejects.toMatchObject({ code: "DELEGATION_PROVIDER_UNSUPPORTED" });
    expect(supported.exec).not.toHaveBeenCalled();
  });

  it("maps bounded access presets and hides owner, universal, and negative ACLs", async () => {
    const state = harness(new Map([
      ["owner@example.com", "lrswipkxtea"], ["anyone", "lr"],
      ["-blocked@example.com", "w"], ["reader@example.com", "lr"],
      ["manager@example.com", "lrswite"], ["partial@example.com", "lrs"],
      ["custom@example.com", "lrswitep"], ["lookup-only@example.com", "l"],
    ]));
    await expect(new ImapDelegationAdapter(config).list()).resolves.toEqual([
      { access: "manage", identifier: "manager@example.com" },
      { access: "read", identifier: "reader@example.com" },
    ]);
    expect(state.next).toHaveBeenCalledOnce();
  });

  it("rejects provider readback that drops part of a requested preset", async () => {
    harness(new Map(), (rights) => rights === "lrswite" ? "lrs" : rights);
    await expect(new ImapDelegationAdapter(config).set({
      access: "manage", identifier: "peer@example.com",
    })).rejects.toMatchObject({ code: "DELEGATION_CONFIRMATION_FAILED" });
  });

  it("replaces exact rights, confirms readback, and removes the target only", async () => {
    const state = harness(new Map([["other@example.com", "lr"]]));
    const adapter = new ImapDelegationAdapter(config);
    await expect(adapter.set({ access: "manage", identifier: "peer@example.com" }))
      .resolves.toContainEqual({ access: "manage", identifier: "peer@example.com" });
    expect(state.acl.get("peer@example.com")).toBe("lrswite");
    expect(state.acl.get("other@example.com")).toBe("lr");
    await expect(adapter.delete("peer@example.com"))
      .resolves.toEqual([{ access: "read", identifier: "other@example.com" }]);
    expect(state.exec.mock.calls.map(([command]) => command))
      .toEqual(["SETACL", "GETACL", "DELETEACL", "GETACL"]);
  });

  it.each(["owner@example.com", "anyone", "anonymous", "-group"]) (
    "refuses a protected identifier before provider mutation: %s",
    async (identifier) => {
      const state = harness();
      await expect(new ImapDelegationAdapter(config).set({ access: "read", identifier }))
        .rejects.toMatchObject({ code: "DELEGATION_IDENTIFIER_FORBIDDEN" });
      expect(state.exec).not.toHaveBeenCalled();
    },
  );
});
