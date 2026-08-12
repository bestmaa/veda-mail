import { describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import type { MessageSourceDownload } from "@/domain/mail/message-source";
import { id } from "@/domain/shared/brand";
import { prepareMessageSourceArchive } from "@/server/mail/message-source-archive";

const source = (text: string, declared = new TextEncoder().encode(text).byteLength): MessageSourceDownload => {
  const bytes = new TextEncoder().encode(text);
  return { body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), size: declared };
};

describe("message source archive", () => {
  it("streams sequential, interoperable RFC 5322 entries and releases its lease", async () => {
    const downloads = [source("Subject: One\r\n\r\nFirst"), source("Subject: Two\r\n\r\nSecond")];
    const downloadMessageSource = vi.fn(async () => downloads[downloadMessageSource.mock.calls.length - 1]!);
    const release = vi.fn();
    const stream = await prepareMessageSourceArchive({
      lease: { release }, mail: { downloadMessageSource } as unknown as MailApplicationService,
      messageIds: [id.message("one"), id.message("two")], requestSignal: new AbortController().signal,
    });

    expect(downloadMessageSource).toHaveBeenCalledTimes(1);
    const archive = unzipSync(new Uint8Array(await new Response(stream).arrayBuffer()));
    expect(Object.keys(archive)).toEqual(["message-001.eml", "message-002.eml"]);
    expect(new TextDecoder().decode(archive["message-001.eml"])).toBe("Subject: One\r\n\r\nFirst");
    expect(new TextDecoder().decode(archive["message-002.eml"])).toBe("Subject: Two\r\n\r\nSecond");
    expect(downloadMessageSource).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("fails closed on incomplete provider bytes and releases its lease", async () => {
    const release = vi.fn();
    const stream = await prepareMessageSourceArchive({
      lease: { release },
      mail: { downloadMessageSource: vi.fn(async () => source("short", 99)) } as unknown as MailApplicationService,
      messageIds: [id.message("broken")], requestSignal: new AbortController().signal,
    });
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow("incomplete message");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
