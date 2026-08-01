import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: async (value: string) => new URL(value),
}));

import { MailApplicationService } from "@/application/services/mail-application.service";
import { id } from "@/domain/shared/brand";
import { StalwartMailGateway } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.gateway";
import {
  JMAP_CORE,
  JMAP_MAIL,
  type JmapEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { prepareAttachmentArchive } from "@/server/mail/attachment-archive";
import type { AttachmentDownloadLease } from "@/server/mail/attachment-download-concurrency";
import { parseStoreZip } from "@/../tests/support/store-zip";
import { receivedScanFixture } from "@/../tests/unit/received-attachment-scan.fixture";

const origin = "https://mail.example.com";
const messageId = id.message("stalwart-archive-message");
const first = Uint8Array.of(0, 255, 1);
const second = Uint8Array.of(9, 8, 7, 6);
const email: JmapEmail = {
  attachments: [
    {
      blobId: "private-blob-one",
      disposition: "attachment",
      name: "first.bin",
      partId: "part-one",
      size: first.byteLength,
      type: "application/octet-stream",
    },
    {
      blobId: "private-blob-two",
      disposition: "attachment",
      name: "second.bin",
      partId: "part-two",
      size: second.byteLength,
      type: "application/octet-stream",
    },
  ],
  hasAttachment: true,
  id: messageId,
  keywords: {},
  mailboxIds: { inbox: true },
  preview: "",
  receivedAt: "2026-08-02T00:00:00.000Z",
  size: 7,
  subject: "Archive",
  threadId: "stalwart-archive-thread",
};
const session = {
  accounts: { "account-one": { isReadOnly: false, name: "Member" } },
  apiUrl: `${origin}/jmap`,
  capabilities: { [JMAP_CORE]: { maxSizeUpload: 25_000_000 } },
  downloadUrl: `${origin}/download/{accountId}/{blobId}/{name}?type={type}`,
  primaryAccounts: { [JMAP_MAIL]: "account-one" },
  uploadUrl: `${origin}/upload/{accountId}`,
  username: "member@example.com",
};

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("Stalwart Download all scan integration", () => {
  it("revalidates and scans every opaque attachment before ZIP delivery", async () => {
    const providerFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/.well-known/jmap") return Response.json(session);
      if (url.pathname === "/jmap") {
        return Response.json({
          methodResponses: [[
            "Email/get",
            { accountId: "account-one", list: [email], state: "state-one" },
            "attachment-email",
          ]],
          sessionState: "state-one",
        });
      }
      if (url.pathname.includes("private-blob-one")) {
        return new Response(first);
      }
      if (url.pathname.includes("private-blob-two")) {
        return new Response(second);
      }
      throw new Error(`Unexpected provider request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", providerFetch);
    const fixture = await receivedScanFixture();
    directories.push(fixture.directory);
    const release = vi.fn();
    const mail = new MailApplicationService(new StalwartMailGateway({
      authType: "basic",
      baseUrl: origin,
      secret: "provider-secret",
      username: "member@example.com",
    }));

    const stream = await prepareAttachmentArchive({
      connectionId: "stalwart-archive-connection",
      lease: { release } as AttachmentDownloadLease,
      mail,
      messageId,
      requestSignal: new AbortController().signal,
      scanSpool: fixture.spool,
    });
    const entries = parseStoreZip(
      new Uint8Array(await new Response(stream).arrayBuffer()),
    );

    expect(entries.map(({ bytes, name }) => ({ bytes, name }))).toEqual([
      { bytes: first, name: "first.bin" },
      { bytes: second, name: "second.bin" },
    ]);
    expect(
      providerFetch.mock.calls.filter(([input]) =>
        String(input).includes("/download/"),
      ),
    ).toHaveLength(2);
    expect(release).toHaveBeenCalledOnce();
    expect(fixture.spool.stats()).toEqual({ bytes: 0, records: 0 });
  });
});
