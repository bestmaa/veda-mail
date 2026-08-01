import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import type { MailLabel } from "@/domain/mail/label";
import { hasUnpairedContentSurrogate } from "@/domain/mail/outgoing-content-policy";
import type { LabelId } from "@/domain/shared/brand";

export const MAX_LABELS = 256;
export const MAX_LABEL_NAME_CHARACTERS = 100;
export const MAX_LABEL_NAME_BYTES = 255;

export class LabelPolicyError extends Error {
  public constructor(
    public readonly failure: "conflict" | "limit" | "missing" | "name",
    message: string,
  ) {
    super(message);
    this.name = "LabelPolicyError";
  }
}

export const normalizeLabelName = (name: string): string => {
  const value = name.normalize("NFKC").trim();
  if (
    value.length === 0 ||
    value.length > MAX_LABEL_NAME_CHARACTERS ||
    new TextEncoder().encode(value).byteLength > MAX_LABEL_NAME_BYTES ||
    hasHeaderControlCharacter(value) ||
    hasUnpairedContentSurrogate(value)
  ) {
    throw new LabelPolicyError(
      "name",
      "Label names must be valid single-line text up to 100 characters and 255 UTF-8 bytes.",
    );
  }
  return value;
};

export const isCanonicalLabelName = (name: string): boolean => {
  try {
    return normalizeLabelName(name) === name;
  } catch {
    return false;
  }
};

const comparisonName = (name: string): string =>
  name.normalize("NFKC").toLocaleLowerCase("en-US");

export const assertUniqueLabelName = (
  labels: readonly MailLabel[],
  name: string,
  excluding?: LabelId,
): string => {
  const normalized = normalizeLabelName(name);
  if (labels.some((label) =>
    label.id !== excluding &&
    comparisonName(label.name) === comparisonName(normalized),
  )) {
    throw new LabelPolicyError("conflict", "A label with this name already exists.");
  }
  return normalized;
};

export const assertLabelCapacity = (labels: readonly MailLabel[]): void => {
  if (labels.length >= MAX_LABELS) {
    throw new LabelPolicyError("limit", `An account can have up to ${MAX_LABELS} labels.`);
  }
};

export const requireLabel = (
  labels: readonly MailLabel[],
  labelId: LabelId,
): MailLabel => {
  const label = labels.find(({ id }) => id === labelId);
  if (!label) throw new LabelPolicyError("missing", "Label not found.");
  return label;
};
