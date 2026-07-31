import type {
  AdminMailUserDetail,
  AdminMailUserSummary,
} from "@/transport/client/admin-mail-users-api";
import type {
  AdminMailUserDetailViewModel,
  AdminMailUserListItemViewModel,
} from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";

const bytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const amount = value / 1024 ** exponent;
  return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
};

const created = (value: string | null): string => {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Not reported"
    : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
};

const storage = (user: AdminMailUserSummary): string =>
  user.maxDiskQuota === null
    ? `${bytes(user.usedDiskQuota)} used`
    : `${bytes(user.usedDiskQuota)} of ${bytes(user.maxDiskQuota)}`;

export const mailUserListItem = (
  user: AdminMailUserSummary,
): Omit<AdminMailUserListItemViewModel, "onOpen"> => ({
  createdLabel: created(user.createdAt),
  displayName: user.displayName || "Unnamed mailbox",
  email: user.email,
  id: user.id,
  storageLabel: storage(user),
});

export const mailUserDetail = (
  user: AdminMailUserDetail,
): AdminMailUserDetailViewModel => ({
  aliases: user.aliases,
  createdLabel: created(user.createdAt),
  displayName: user.displayName || "Unnamed mailbox",
  email: user.email,
  locale: user.locale || "Not set",
  storageLabel: storage(user),
  timeZone: user.timeZone || "Not set",
});
