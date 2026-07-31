import type { AdminMailUsersSnapshot } from "@/transport/client/admin-mail-users-api";

export interface BoundAdminMailUsersSnapshot {
  readonly domain: string;
  readonly value: AdminMailUsersSnapshot;
}

export const bindAdminMailUsersSnapshot = (
  domain: string,
  value: AdminMailUsersSnapshot,
): BoundAdminMailUsersSnapshot => ({ domain, value });

export const adminMailUsersSnapshotForDomain = (
  snapshot: BoundAdminMailUsersSnapshot | null,
  selectedDomain: string,
): AdminMailUsersSnapshot | null =>
  snapshot?.domain === selectedDomain ? snapshot.value : null;

export const adminMailUsersCapabilityCopy = (
  status: AdminMailUsersSnapshot["status"] | null,
): readonly [string | null, string | null] => {
  if (status === "unsupported") {
    return [
      "Mailbox administration is not supported",
      "The active mail provider does not expose mailbox administration to Veda Mail.",
    ];
  }
  if (status === "unconfigured") {
    return [
      "Mailbox administration needs configuration",
      "Add the Stalwart management API credential and its exact server origin, then retry.",
    ];
  }
  return [null, null];
};
