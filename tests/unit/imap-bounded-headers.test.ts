import { describe, expect, it } from "vitest";

import {
  boundedImapHeaders,
  MAX_IMAP_HEADER_BYTES,
} from "@/infrastructure/providers/imap-smtp/imap-bounded-headers";

describe("bounded IMAP headers", () => {
  it("extracts only the header block from a bounded source fetch", () => {
    const result = boundedImapHeaders({
      source: Buffer.from("Message-ID: <one@example.com>\r\nX-Test: yes\r\n\r\nbody"),
    });

    expect(result).toEqual({
      headers: Buffer.from("Message-ID: <one@example.com>\r\nX-Test: yes\r\n"),
      truncated: false,
    });
  });

  it("accepts an empty header block without exposing body bytes", () => {
    expect(boundedImapHeaders({ source: Buffer.from("\r\nbody") })).toEqual({
      headers: Buffer.alloc(0), truncated: false,
    });
  });

  it("fails closed when the provider omits or overflows the header boundary", () => {
    expect(boundedImapHeaders({})).toEqual({ truncated: true });
    expect(boundedImapHeaders({
      source: Buffer.concat([
        Buffer.alloc(MAX_IMAP_HEADER_BYTES + 1, 0x61),
        Buffer.from("\r\n\r\n"),
      ]),
    })).toEqual({ truncated: true });
  });
});
