import { describe, expect, it } from "vitest";

import { COMPOSER_SIGNATURE_ATTRIBUTE } from "@/presentation/features/mail-workspace/composer-signature.node";
import { canonicalizeOutgoingMailContent } from "@/server/mail/outgoing-mail-content";

describe("composer signature outgoing sanitization", () => {
  it("keeps editable signature content but strips its internal wrapper", () => {
    const content = canonicalizeOutgoingMailContent({
      body: "Untrusted fallback",
      htmlBody:
        "<p>Hello</p>" +
        `<div ${COMPOSER_SIGNATURE_ATTRIBUTE}="work">` +
        "<p><strong>Ada Lovelace</strong><br>Engineering</p></div>",
    });

    expect(content.htmlBody).toContain("<strong>Ada Lovelace</strong>");
    expect(content.htmlBody).toContain("Engineering");
    expect(content.htmlBody).not.toContain(COMPOSER_SIGNATURE_ATTRIBUTE);
    expect(content.htmlBody).not.toContain("<div");
    expect(content.body).toContain("Ada Lovelace");
    expect(content.body).not.toContain("Untrusted fallback");
  });
});
