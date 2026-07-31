import { z } from "zod";

import type { DraftContent } from "@/domain/mail/draft";
import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import { hasCanonicalDraftMailContent } from "@/domain/mail/outgoing-mail-canonicalizer";

const canonicalEmail = z.string().trim().max(254).email();

const hasCanonicalAddress = (address: DraftContent["to"][number]): boolean => {
  const email = canonicalEmail.safeParse(address.email);
  const name = address.name === null ? null : address.name.trim() || null;
  return (
    email.success &&
    email.data === address.email &&
    name === address.name &&
    (name === null || (name.length <= 200 && !hasHeaderControlCharacter(name)))
  );
};

export const hasCanonicalDraftContent = (content: DraftContent): boolean => {
  if (
    content.subject !== content.subject.trim() ||
    content.subject.length > 998 ||
    hasHeaderControlCharacter(content.subject) ||
    (content.inReplyTo !== undefined &&
      (content.inReplyTo !== content.inReplyTo.trim() ||
        content.inReplyTo.length > 2_048 ||
        hasHeaderControlCharacter(content.inReplyTo))) ||
    !hasCanonicalDraftMailContent(content)
  ) {
    return false;
  }
  const recipients = [content.to, content.cc, content.bcc];
  if (
    recipients.some((values) => values.length > 100) ||
    recipients.reduce((total, values) => total + values.length, 0) > 100
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (const address of recipients.flat()) {
    const key = address.email.toLowerCase();
    if (!hasCanonicalAddress(address) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};
