import "server-only";

import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";

type BodyPart = NonNullable<JmapDraftEmail["bodyStructure"]>;

const mediaType = (value: string): string =>
  value.split(";", 1)[0]?.trim().toLowerCase() ?? "";

const hasNoLeafMetadata = (part: BodyPart): boolean =>
  !part.disposition &&
  !part.cid &&
  !(part.language?.length ?? 0) &&
  !part.location &&
  !part.name;

export const contentTypeParametersAreSafe = (
  value: string,
  expectedType: string,
): boolean => {
  const sections = value.split(";").map((section) => section.trim());
  if (sections.shift()?.toLowerCase() !== expectedType) return false;
  const allowed = expectedType.startsWith("text/") ? "charset" : "boundary";
  if (
    (allowed === "charset" && sections.length > 1) ||
    (allowed === "boundary" && sections.length !== 1)
  ) {
    return false;
  }
  return sections.every((section) => {
    const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"[^"\\\r\n]*")$/.exec(
      section,
    );
    return match?.[1]?.toLowerCase() === allowed;
  });
};

const hasSafePartHeaders = (
  part: BodyPart,
  expectedType: string,
): boolean => {
  if (!part.headers) return false;
  const names = part.headers.map(({ name }) => name.toLowerCase());
  if (
    new Set(names).size !== names.length ||
    names.some(
      (name) =>
        name !== "content-type" && name !== "content-transfer-encoding",
    )
  ) {
    return false;
  }
  const contentType = part.headers.find(
    ({ name }) => name.toLowerCase() === "content-type",
  );
  const encoding = part.headers.find(
    ({ name }) => name.toLowerCase() === "content-transfer-encoding",
  );
  return (
    Boolean(contentType) &&
    contentTypeParametersAreSafe(contentType?.value ?? "", expectedType) &&
    (expectedType === "multipart/alternative"
      ? !encoding
      : !encoding ||
        /^(?:7bit|8bit|base64|binary|quoted-printable)$/i.test(
          encoding.value.trim(),
        ))
  );
};

const safeLeaf = (
  part: BodyPart,
  expectedType: "text/html" | "text/plain",
): boolean =>
  mediaType(part.type) === expectedType &&
  part.type.trim().toLowerCase() === expectedType &&
  Boolean(part.partId) &&
  (part.subParts?.length ?? 0) === 0 &&
  hasNoLeafMetadata(part) &&
  hasSafePartHeaders(part, expectedType);

const exactPart = (
  parts: readonly BodyPart[] | undefined,
  expected: BodyPart,
  type: "text/html" | "text/plain",
): boolean =>
  parts?.length === 1 &&
  parts[0]?.partId === expected.partId &&
  safeLeaf(parts[0]!, type);

const safeMessageBody = (email: JmapDraftEmail, root: BodyPart): boolean => {
  if (safeLeaf(root, "text/plain")) {
    return exactPart(email.textBody, root, "text/plain") &&
      (email.htmlBody?.length ?? 0) === 0;
  }
  const parts = root.subParts ?? [];
  const plain = parts[0];
  const html = parts[1];
  return mediaType(root.type) === "multipart/alternative" &&
    root.type.trim().toLowerCase() === "multipart/alternative" &&
    parts.length === 2 && Boolean(plain && html) && hasNoLeafMetadata(root) &&
    hasSafePartHeaders(root, "multipart/alternative") &&
    safeLeaf(plain!, "text/plain") && safeLeaf(html!, "text/html") &&
    exactPart(email.textBody, plain!, "text/plain") &&
    exactPart(email.htmlBody, html!, "text/html");
};

const safeAttachmentLeaf = (part: BodyPart): boolean => {
  const type = mediaType(part.type);
  return Boolean(part.blobId) && Boolean(part.partId) && Boolean(part.name) &&
    type.length > 0 && part.type.trim().toLowerCase() === type &&
    part.disposition?.trim().toLowerCase() === "attachment" &&
    (part.subParts?.length ?? 0) === 0 && !part.cid &&
    !(part.language?.length ?? 0) && !part.location &&
    Number.isSafeInteger(part.size) && (part.size ?? -1) >= 0;
};

const sameAttachmentInventory = (
  listed: readonly BodyPart[] | undefined,
  parts: readonly BodyPart[],
): boolean => JSON.stringify((listed ?? []).map((part) => ({
  blobId: part.blobId ?? null,
  disposition: part.disposition?.toLowerCase() ?? null,
  name: part.name ?? null,
  partId: part.partId ?? null,
  size: part.size ?? null,
  type: mediaType(part.type),
}))) === JSON.stringify(parts.map((part) => ({
  blobId: part.blobId ?? null,
  disposition: part.disposition?.toLowerCase() ?? null,
  name: part.name ?? null,
  partId: part.partId ?? null,
  size: part.size ?? null,
  type: mediaType(part.type),
})));

export const hasSupportedDraftBodyStructure = (
  email: JmapDraftEmail,
): boolean => {
  const root = email.bodyStructure;
  if (!root) return false;
  if (safeMessageBody(email, root)) return (email.attachments?.length ?? 0) === 0;
  const parts = root.subParts ?? [];
  const message = parts[0];
  const attachments = parts.slice(1);
  const attachmentBytes = attachments.reduce(
    (total, part) => total + (part.size ?? Number.POSITIVE_INFINITY),
    0,
  );
  return mediaType(root.type) === "multipart/mixed" &&
    root.type.trim().toLowerCase() === "multipart/mixed" &&
    parts.length >= 2 && parts.length <= 11 && Boolean(message) &&
    hasNoLeafMetadata(root) && hasSafePartHeaders(root, "multipart/mixed") &&
    safeMessageBody(email, message!) && attachmentBytes <= 18 * 1024 * 1024 &&
    attachments.every(safeAttachmentLeaf) &&
    sameAttachmentInventory(email.attachments, attachments);
};
