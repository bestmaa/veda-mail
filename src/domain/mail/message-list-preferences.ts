import type { ProviderId } from "@/domain/shared/brand";

export const MESSAGE_LIST_DENSITIES = [
  "compact",
  "comfortable",
  "spacious",
] as const;

export const MESSAGE_LIST_SORTS = ["newest", "oldest"] as const;

export type MessageListDensity = (typeof MESSAGE_LIST_DENSITIES)[number];
export type MessageListSort = (typeof MESSAGE_LIST_SORTS)[number];

export interface MessageListPreferences {
  readonly density: MessageListDensity;
  readonly showPreview: boolean;
  readonly sort: MessageListSort;
}

export interface MessageListPreferencesOwner {
  readonly email: string;
  readonly providerId: ProviderId | string;
}

export const DEFAULT_MESSAGE_LIST_PREFERENCES: MessageListPreferences = {
  density: "comfortable",
  showPreview: true,
  sort: "newest",
};
