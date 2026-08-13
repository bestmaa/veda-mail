export const MAX_DELEGATION_IDENTIFIER_BYTES = 320;
export const MAX_DELEGATION_REQUEST_BYTES = 2 * 1024;

export type DelegationAccess = "manage" | "read";

export type DelegationCapability =
  | { readonly mailbox: "INBOX"; readonly supported: true }
  | { readonly reason: string; readonly supported: false };

export interface DelegationEntry {
  readonly access: DelegationAccess;
  readonly identifier: string;
}

export interface DelegationUpdate {
  readonly access: DelegationAccess;
  readonly identifier: string;
}

export interface DelegationWorkspace {
  readonly capability: DelegationCapability;
  readonly entries: readonly DelegationEntry[];
}
