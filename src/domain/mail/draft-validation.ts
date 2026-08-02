import { DraftInputError } from "@/domain/mail/draft-errors";
import type { DraftSaveInput } from "@/domain/mail/draft";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
} from "@/domain/mail/outgoing-content-policy";
import { id, type DraftId } from "@/domain/shared/brand";

const composeIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const canonicalDraftComposeId = (value: DraftId): DraftId => {
  if (!composeIdPattern.test(value)) throw new DraftInputError();
  return id.draft(value.toLowerCase());
};

export const isCanonicalDraftComposeHeader = (
  value: unknown,
): value is DraftId =>
  typeof value === "string" &&
  composeIdPattern.test(value) &&
  value === value.toLowerCase();

export const assertDraftRevision = (value: unknown): string => {
  if (
    !isSafeDraftMetadataValue(value)
  ) {
    throw new DraftInputError();
  }
  return value;
};

export const isSafeDraftMetadataValue = (
  value: unknown,
): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 1_024 &&
  !hasDisallowedContentControl(value) &&
  !hasUnpairedContentSurrogate(value);

export const validateDraftSaveInput = (
  input: DraftSaveInput,
): DraftSaveInput => {
  canonicalDraftComposeId(input.composeId);
  const hasProviderId = typeof input.providerDraftId === "string";
  const hasRevision = input.expectedRevision !== undefined;
  if (hasProviderId !== hasRevision || (!hasProviderId && hasRevision)) {
    throw new DraftInputError();
  }
  if (hasRevision) assertDraftRevision(input.expectedRevision);
  const retained = input.retainedAttachmentIds ?? [];
  const attachments = input.attachments ?? [];
  if (
    retained.length > 10 ||
    new Set(retained).size !== retained.length ||
    retained.some((value) => !isSafeDraftMetadataValue(value)) ||
    (!hasProviderId && retained.length > 0) ||
    attachments.length > 10 ||
    retained.length + attachments.length > 10
  ) {
    throw new DraftInputError();
  }
  return input;
};
