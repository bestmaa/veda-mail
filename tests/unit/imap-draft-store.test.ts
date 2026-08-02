import type { ImapFlow } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftContent } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { composeImapDraft } from "@/infrastructure/providers/imap-smtp/imap-draft-mime";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const mocks = vi.hoisted(() => ({ client: null as unknown as ImapFlow }));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (
    _config: unknown,
    task: (client: ImapFlow) => Promise<unknown>,
  ) => task(mocks.client),
}));

import { ImapDraftStore } from "@/infrastructure/providers/imap-smtp/imap-draft.store";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com",
  imapPort: "993",
  imapSecurity: "tls",
  secret: "provider-secret",
  smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "26214400",
  smtpPort: "465",
  smtpSecurity: "tls",
  username: "member@example.com",
};
const composeId = id.draft("11111111-1111-4111-8111-111111111111");
const content: DraftContent = {
  bcc: [],
  body: "Initial body",
  cc: [{ email: "cc@example.com", name: null }],
  htmlBody: "<p>Initial body</p>",
  subject: "Initial subject",
  to: [{ email: "to@example.com", name: "Recipient" }],
};

interface StoredMessage {
  readonly date: Date;
  readonly source: Buffer;
}

const headerValue = (source: Buffer, name: string): string | null => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.toString("utf8").match(
    new RegExp(`^${escaped}:\\s*([^\\r\\n]+)`, "imu"),
  );
  return match?.[1]?.trim() ?? null;
};

const fakeClient = () => {
  const deleteFailures = new Set<number>();
  const messages = new Map<number, StoredMessage>();
  let nextUid = 10;
  const client = {
    append: vi.fn(async (
      _mailbox: string, source: Buffer,
    ): Promise<{ destination: string; uid?: number; uidValidity?: bigint }> => {
      const uid = nextUid++;
      messages.set(uid, { date: new Date("2026-08-02T09:00:00Z"), source });
      return { destination: "Drafts", uid, uidValidity: BigInt(9) };
    }),
    capabilities: new Map([["UIDPLUS", true]]),
    fetchOne: vi.fn(async (uid: number) => {
      const message = messages.get(uid);
      return message
        ? {
            internalDate: message.date,
            seq: uid,
            size: message.source.byteLength,
            source: message.source,
            uid,
          }
        : false;
    }),
    list: vi.fn().mockResolvedValue([
      {
        flags: new Set<string>(),
        listed: true,
        name: "Drafts",
        path: "Drafts",
        specialUse: "\\Drafts",
      },
    ]),
    mailboxOpen: vi.fn().mockResolvedValue({
      exists: 0,
      readOnly: false,
      uidValidity: BigInt(9),
    }),
    messageDelete: vi.fn(async (uid: number) =>
      deleteFailures.has(uid) ? false : messages.delete(uid)),
    search: vi.fn(async (query: { header: Record<string, string> }) => {
      const [name, value] = Object.entries(query.header)[0] ?? [];
      if (!name || !value) return false;
      const found = [...messages.entries()]
        .filter(([, message]) => headerValue(message.source, name) === value)
        .map(([uid]) => uid);
      return found.length > 0 ? found : false;
    }),
  };
  return { client, deleteFailures, messages };
};

const providerId = (uid: number, memberConfig = config) =>
  id.providerDraft(
    encodeScopedImapMessageId(memberConfig, {
      mailbox: "Drafts",
      uid,
      uidValidity: BigInt(9),
    }),
  );

let fake: ReturnType<typeof fakeClient>;
let store: ImapDraftStore;

beforeEach(() => {
  fake = fakeClient();
  mocks.client = fake.client as unknown as ImapFlow;
  store = new ImapDraftStore(config);
});

describe("IMAP draft store", () => {
  it("reports writable Drafts mailbox capability", async () => {
    await expect(store.capability()).resolves.toEqual({ status: "supported" });
    fake.client.mailboxOpen.mockResolvedValueOnce({
      readOnly: true,
      uidValidity: BigInt(9),
    });
    await expect(store.capability()).resolves.toEqual({ status: "unavailable" });
    fake.client.capabilities.clear();
    await expect(store.capability()).resolves.toEqual({ status: "unavailable" });
  });

  it("creates a durable draft and recovers an idempotent retry", async () => {
    const first = await store.save({ composeId, content });
    const retry = await store.save({ composeId, content });

    expect(first).toMatchObject({
      composeId,
      content,
      hasTruncatedContent: false,
      id: providerId(10),
    });
    expect(retry).toEqual(first);
    expect(fake.client.append).toHaveBeenCalledOnce();
  });

  it("serializes concurrent creates into one provider draft", async () => {
    const [first, second] = await Promise.all([
      store.save({ composeId, content }),
      store.save({ composeId, content }),
    ]);

    expect(second).toEqual(first);
    expect(fake.client.append).toHaveBeenCalledOnce();
    expect(fake.messages.size).toBe(1);
  });

  it("recovers a successful APPEND when the provider omits its UID", async () => {
    fake.client.append.mockImplementationOnce(async (_mailbox, source) => {
      fake.messages.set(10, { date: new Date(), source });
      return { destination: "Drafts" };
    });

    await expect(store.save({ composeId, content })).resolves.toMatchObject({
      id: providerId(10),
    });
  });

  it("replaces the expected immutable draft and returns its new provider ID", async () => {
    const first = await store.save({ composeId, content });
    const { htmlBody: _htmlBody, ...plainContent } = content;
    void _htmlBody;
    const changed = { ...plainContent, body: "Changed body" };
    const replacement = await store.save({
      composeId,
      content: changed,
      expectedRevision: first.revision,
      providerDraftId: first.id,
    });

    expect(replacement).toMatchObject({ content: changed, id: providerId(11) });
    expect(fake.messages.has(10)).toBe(false);
    expect(fake.messages.has(11)).toBe(true);
  });

  it("rejects stale revisions before appending replacement content", async () => {
    const first = await store.save({ composeId, content });

    await expect(
      store.save({
        composeId,
        content: { ...content, body: "Changed" },
        expectedRevision: "stale-revision",
        providerDraftId: first.id,
      }),
    ).rejects.toMatchObject({ name: "DraftConflictError" });
    expect(fake.client.append).toHaveBeenCalledOnce();
  });

  it("removes an uncommitted replacement when old-draft deletion fails", async () => {
    const first = await store.save({ composeId, content });
    fake.deleteFailures.add(10);

    await expect(
      store.save({
        composeId,
        content: { ...content, body: "Changed" },
        expectedRevision: first.revision,
        providerDraftId: first.id,
      }),
    ).rejects.toMatchObject({ name: "DraftConflictError" });
    expect([...fake.messages.keys()]).toEqual([10]);
  });

  it("does not replace unsafe foreign MIME content", async () => {
    const { raw } = await composeImapDraft(content, composeId, config.username);
    fake.messages.set(10, {
      date: new Date(),
      source: Buffer.from(`Reply-To: attacker@example.com\r\n${raw.toString("utf8")}`),
    });
    const loaded = await store.get(providerId(10));

    await expect(
      store.save({
        composeId,
        content,
        expectedRevision: loaded.revision,
        providerDraftId: loaded.id,
      }),
    ).rejects.toMatchObject({ name: "DraftContentTruncatedError" });
    expect(fake.client.append).not.toHaveBeenCalled();
  });

  it("discards only the account-scoped draft with the expected revision", async () => {
    const saved = await store.save({ composeId, content });
    const otherAccountId = providerId(10, { ...config, username: "other@example.com" });

    await expect(store.discard(otherAccountId, saved.revision)).rejects.toMatchObject({
      name: "DraftNotFoundError",
    });
    await store.discard(saved.id, saved.revision);
    expect(fake.messages.size).toBe(0);
  });
});
