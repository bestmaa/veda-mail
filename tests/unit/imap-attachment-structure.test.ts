import type { MessageStructureObject } from "imapflow";
import { describe, expect, it } from "vitest";

import {
  assertSafeImapPartSpecifier,
  collectImapAttachmentParts,
  createImapAttachmentDownloadTarget,
  findImapBodyPart,
} from "@/infrastructure/providers/imap-smtp/imap-attachment-structure";

const structure: MessageStructureObject = {
  childNodes: [
    {
      part: "1",
      parameters: { charset: "utf-8" },
      size: 12,
      type: "text/plain",
    },
    {
      disposition: "attachment",
      dispositionParameters: { filename: 'résumé "final".pdf' },
      encoding: "BASE64",
      part: "2",
      size: 1_024,
      type: "APPLICATION/PDF",
    },
    {
      childNodes: [
        {
          disposition: "inline",
          id: "<logo@example.test>",
          parameters: { name: "logo.png" },
          part: "3.1",
          size: 256,
          type: "image/png",
        },
      ],
      part: "3",
      type: "multipart/related",
    },
  ],
  type: "multipart/mixed",
};

describe("IMAP attachment body structure", () => {
  it("maps named and inline parts into targeted metadata", () => {
    expect(collectImapAttachmentParts(structure)).toEqual([
      {
        contentId: null,
        contentType: "application/pdf",
        disposition: "attachment",
        filename: 'résumé "final".pdf',
        part: "2",
        size: 1_024,
        transferEncoding: "base64",
      },
      {
        contentId: "logo@example.test",
        contentType: "image/png",
        disposition: "inline",
        filename: "logo.png",
        part: "3.1",
        size: 256,
        transferEncoding: null,
      },
    ]);
  });

  it("renders supported CID raster leaves and preserves unsupported image fallbacks", () => {
    const related: MessageStructureObject = {
      childNodes: [
        {
          id: " <hero@example.test> ",
          part: "1",
          size: 128,
          type: "IMAGE/PNG",
        },
        {
          id: "<vector@example.test>",
          part: "2",
          size: 64,
          type: "image/svg+xml",
        },
        {
          id: "<animation@example.test>",
          part: "3",
          size: 64,
          type: "image/gif",
        },
        {
          childNodes: [{ part: "4.1", type: "image/png" }],
          id: "<container@example.test>",
          part: "4",
          type: "image/png",
        },
      ],
      type: "multipart/related",
    };

    expect(collectImapAttachmentParts(related)).toEqual([
      {
        contentId: "hero@example.test",
        contentType: "image/png",
        disposition: "inline",
        filename: "attachment.bin",
        part: "1",
        size: 128,
        transferEncoding: null,
      },
      {
        contentId: "vector@example.test",
        contentType: "image/svg+xml",
        disposition: "attachment",
        filename: "attachment.bin",
        part: "2",
        size: 64,
        transferEncoding: null,
      },
      {
        contentId: "animation@example.test",
        contentType: "image/gif",
        disposition: "attachment",
        filename: "attachment.bin",
        part: "3",
        size: 64,
        transferEncoding: null,
      },
    ]);
  });

  it("infers part 1 for a single-part root attachment", () => {
    const root: MessageStructureObject = {
      disposition: "attachment",
      dispositionParameters: { filename: "report.csv" },
      size: 0,
      type: "text/csv",
    };

    expect(collectImapAttachmentParts(root)[0]?.part).toBe("1");
    expect(findImapBodyPart(root, "1")).toBe(root);
  });

  it("finds a validated part and creates a streaming download target", () => {
    const attachment = collectImapAttachmentParts(structure)[0];
    if (!attachment) throw new Error("Missing attachment fixture.");

    expect(findImapBodyPart(structure, "3.1")?.type).toBe("image/png");
    expect(
      createImapAttachmentDownloadTarget(
        42,
        attachment,
        BigInt("9007199254740993"),
      ),
    ).toEqual({
      expectedSize: 1_024,
      part: "2",
      uid: 42,
      uidValidity: "9007199254740993",
    });
  });

  it("rejects part and UID injection", () => {
    const attachment = collectImapAttachmentParts(structure)[0];
    if (!attachment) throw new Error("Missing attachment fixture.");

    expect(() => assertSafeImapPartSpecifier("1.2\r\nUID FETCH")).toThrow(
      /invalid/,
    );
    expect(() => assertSafeImapPartSpecifier("0.1")).toThrow(/invalid/);
    expect(() => createImapAttachmentDownloadTarget(0, attachment)).toThrow(
      /positive/,
    );
    expect(() =>
      createImapAttachmentDownloadTarget(1, attachment, BigInt(0)),
    ).toThrow(/UIDVALIDITY/);
  });

  it("fails closed on an injected provider filename or part", () => {
    const badFilename: MessageStructureObject = {
      disposition: "attachment",
      dispositionParameters: { filename: "safe.txt\r\nX-Evil: yes" },
      part: "1",
      type: "text/plain",
    };
    const badPart: MessageStructureObject = {
      disposition: "attachment",
      dispositionParameters: { filename: "safe.txt" },
      part: "1\r\nBODY[]",
      type: "text/plain",
    };

    expect(() => collectImapAttachmentParts(badFilename)).toThrow(/CR or LF/);
    expect(() => collectImapAttachmentParts(badPart)).toThrow(/invalid/);
  });

  it("handles a cyclic provider structure without looping", () => {
    const cyclic: MessageStructureObject = {
      type: "multipart/mixed",
    };
    cyclic.childNodes = [cyclic];

    expect(collectImapAttachmentParts(cyclic)).toEqual([]);
  });
});
