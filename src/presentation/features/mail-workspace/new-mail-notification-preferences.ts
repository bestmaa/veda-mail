import type { NotificationContent } from "@/domain/mail/new-mail-notification";

const STORAGE_KEY = "veda-mail:new-mail-notifications:v1";

export interface NewMailNotificationPreferences {
  readonly content: NotificationContent;
  readonly owner: string;
  readonly webEnabled: boolean;
}

export const defaultNotificationPreferences = (
  owner: string,
): NewMailNotificationPreferences => ({
  content: "private",
  owner,
  webEnabled: false,
});

const isPreferences = (
  value: unknown,
  owner: string,
): value is NewMailNotificationPreferences => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 3 &&
    record["owner"] === owner &&
    (record["content"] === "private" || record["content"] === "details") &&
    typeof record["webEnabled"] === "boolean";
};

export const notificationPreferenceOwner = (
  providerId: string,
  accountId: string,
): string => `${providerId.length}:${providerId}${accountId}`;

export const readNotificationPreferences = (
  storage: Pick<Storage, "getItem">,
  owner: string,
): NewMailNotificationPreferences => {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (!stored || stored.length > 2_048) return defaultNotificationPreferences(owner);
    const parsed: unknown = JSON.parse(stored);
    return isPreferences(parsed, owner) ? parsed :
      defaultNotificationPreferences(owner);
  } catch {
    return defaultNotificationPreferences(owner);
  }
};

export const writeNotificationPreferences = (
  storage: Pick<Storage, "setItem">,
  preferences: NewMailNotificationPreferences,
): boolean => {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
};
