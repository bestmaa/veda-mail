import type { LabelId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";

export const LABEL_COLORS = [
  "#64748b",
  "#4f46e5",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#d946ef",
] as const;

export type LabelColor = (typeof LABEL_COLORS)[number];

export interface MailLabel {
  readonly color: LabelColor;
  readonly id: LabelId;
  readonly name: string;
}

export type LabelCapability = "supported" | "unsupported";

export interface LabelOwner {
  readonly email: string;
  readonly providerId: string;
}

const LABEL_ID = /^veda-label-[a-z2-7]{26}$/u;
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

const base32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

export const createLabelId = (randomHex: string): LabelId => {
  if (!/^[0-9a-f]{32}$/u.test(randomHex)) {
    throw new Error("Label entropy is invalid.");
  }
  const bytes = new Uint8Array(
    randomHex.match(/.{2}/gu)!.map((pair) => Number.parseInt(pair, 16)),
  );
  const value = `veda-label-${base32(bytes)}`;
  if (!LABEL_ID.test(value)) throw new Error("Label identifier is invalid.");
  return id.label(value);
};

export const labelIdFromKeyword = (value: string): LabelId | null => {
  const normalized = value.toLowerCase();
  return LABEL_ID.test(normalized) ? id.label(normalized) : null;
};
