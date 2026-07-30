import type { MessageStructureObject } from "imapflow";
import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  collectImapAttachmentParts,
  findImapBodyPart,
} from "@/infrastructure/providers/imap-smtp/imap-attachment-structure";
import {
  bindImapReceivedAttachments,
  imapAttachmentAccountScope,
} from "@/infrastructure/providers/imap-smtp/imap-received-attachment";

const account = {
  imapHost: "imap.example.com",
  imapPort: "993",
  username: "member@example.com",
};

describe("IMAP attachment ambiguity", () => {
  it("removes duplicate body sections and refuses first-match lookup", () => {
    const structure: MessageStructureObject = {
      childNodes: [
        {
          disposition: "attachment",
          dispositionParameters: { filename: "first.pdf" },
          part: "2",
          type: "application/pdf",
        },
        {
          disposition: "attachment",
          dispositionParameters: { filename: "second.pdf" },
          part: "2",
          type: "application/pdf",
        },
      ],
      type: "multipart/mixed",
    };

    expect(collectImapAttachmentParts(structure)).toEqual([]);
    expect(findImapBodyPart(structure, "2")).toBeNull();
  });

  it("does not expose a section also claimed by a non-attachment node", () => {
    const structure: MessageStructureObject = {
      childNodes: [
        { part: "2", type: "text/plain" },
        {
          disposition: "attachment",
          dispositionParameters: { filename: "ambiguous.pdf" },
          part: "2",
          type: "application/pdf",
        },
      ],
      type: "multipart/mixed",
    };

    expect(collectImapAttachmentParts(structure)).toEqual([]);
    expect(findImapBodyPart(structure, "2")).toBeNull();
  });

  it("forces a CID shared by inline and explicit rasters to fallback", () => {
    const structure: MessageStructureObject = {
      childNodes: [
        {
          id: "<shared@example.test>",
          part: "1",
          type: "image/png",
        },
        {
          disposition: "attachment",
          id: "shared@example.test",
          part: "2",
          type: "image/jpeg",
        },
      ],
      type: "multipart/related",
    };

    expect(
      bindImapReceivedAttachments({
        accountScope: imapAttachmentAccountScope(account),
        messageId: id.message("message"),
        structure,
        uidValidity: BigInt(123),
      }).map(({ metadata }) => metadata.disposition),
    ).toEqual(["attachment", "attachment"]);
  });
});
