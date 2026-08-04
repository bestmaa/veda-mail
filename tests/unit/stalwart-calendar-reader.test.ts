import { describe, expect, it, vi } from "vitest";

import { asCalendarPartId } from "@/domain/mail/calendar";
import { id } from "@/domain/shared/brand";
import { readJmapReceivedAttachmentProviderBlobId } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  downloadStalwartCalendarPart,
  listStalwartCalendarParts,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-calendar.reader";
import type { JmapMethodCall } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const messageId = id.message("message");
const result = {
  accountId: "account",
  list: [{
    bodyStructure: {
      subParts: [
        { blobId: "plain", partId: "1", type: "text/plain" },
        {
          blobId: "private-calendar-blob",
          partId: "2",
          size: 8,
          type: "text/calendar",
        },
      ],
      type: "multipart/alternative",
    },
    id: "message",
  }],
  state: "state",
};

const fakeClient = () => {
  let calls: readonly JmapMethodCall[] = [];
  let signal: AbortSignal | undefined;
  const downloadAttachment = vi.fn().mockResolvedValue({
    body: new Response("calendar").body!,
    mimeType: "text/calendar",
    name: "invite.ics",
    size: 8,
  });
  return {
    client: {
      downloadAttachment,
      request: vi.fn(async (
        nextCalls: readonly JmapMethodCall[],
        _using: readonly string[],
        nextSignal?: AbortSignal,
      ) => {
        calls = nextCalls;
        signal = nextSignal;
        return { methodResponses: [], sessionState: "state" };
      }),
      result: vi.fn(() => result),
    } as unknown as StalwartJmapClient,
    downloadAttachment,
    getCalls: () => calls,
    getSignal: () => signal,
  };
};

describe("Stalwart calendar provider reader", () => {
  it("requests bounded body structure and exposes only opaque metadata", async () => {
    const fake = fakeClient();
    const controller = new AbortController();

    const parts = await listStalwartCalendarParts(fake.client, "account", {
      messageId,
      signal: controller.signal,
    });

    expect(fake.getCalls()[0]?.[1]).toEqual({
      accountId: "account",
      bodyProperties: [
        "partId", "blobId", "size", "name", "type", "disposition", "cid",
      ],
      ids: ["message"],
      properties: ["id", "bodyStructure"],
    });
    expect(fake.getSignal()).toBe(controller.signal);
    expect(parts).toMatchObject([
      { mimeType: "text/calendar", name: "invite.ics", size: 8 },
    ]);
    expect(JSON.stringify(parts)).not.toContain("private-calendar-blob");
  });

  it("rebinds the opaque ID to the exact message/blob before download", async () => {
    const fake = fakeClient();
    const [part] = await listStalwartCalendarParts(fake.client, "account", {
      messageId,
    });
    if (!part) throw new Error("Missing calendar fixture.");

    const download = await downloadStalwartCalendarPart(fake.client, "account", {
      calendarPartId: part.id,
      maxBytes: 1_024,
      messageId,
    });

    const argument = fake.downloadAttachment.mock.calls[0]?.[0];
    expect(argument).toMatchObject({
      accountId: "account",
      maxBytes: 1_024,
      messageId: "message",
    });
    expect(readJmapReceivedAttachmentProviderBlobId(argument.attachment)).toBe(
      "private-calendar-blob",
    );
    expect(await new Response(download.body).text()).toBe("calendar");
    expect(download).toMatchObject({ mimeType: "text/calendar", size: 8 });
  });

  it("rejects cross-message IDs and mismatched provider responses", async () => {
    const fake = fakeClient();
    const [part] = await listStalwartCalendarParts(fake.client, "account", {
      messageId,
    });
    if (!part) throw new Error("Missing calendar fixture.");

    await expect(downloadStalwartCalendarPart(fake.client, "account", {
      calendarPartId: part.id,
      maxBytes: 1_024,
      messageId: id.message("other"),
    })).rejects.toMatchObject({ code: "not_found" });

    const mismatch = fakeClient();
    vi.mocked(mismatch.client.result).mockReturnValue({
      ...result,
      accountId: "other",
    });
    await expect(listStalwartCalendarParts(mismatch.client, "account", {
      messageId,
    })).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects unknown opaque identifiers without provider download", async () => {
    const fake = fakeClient();
    await expect(downloadStalwartCalendarPart(fake.client, "account", {
      calendarPartId: asCalendarPartId("unknown"),
      maxBytes: 1_024,
      messageId,
    })).rejects.toMatchObject({ code: "not_found" });
    expect(fake.downloadAttachment).not.toHaveBeenCalled();
  });
});
