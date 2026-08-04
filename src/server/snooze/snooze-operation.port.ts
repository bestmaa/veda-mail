import "server-only";

import type {
  SnoozeCapability,
  SnoozeOwnedMailbox,
  SnoozePreflightInput,
  SnoozePreflightResult,
  SnoozeProviderInspection,
  SnoozeProviderPlan,
  SnoozeProviderOperationResult,
} from "@/domain/mail/snooze";
import { SnoozeProviderError } from "@/domain/mail/snooze";
export { SnoozeProviderError };
import type { ProviderConnection } from "@/domain/provider/provider";

export interface SnoozeOperationPort {
  mailboxIntent(connection: ProviderConnection): Promise<SnoozeOwnedMailbox>;
  getCapability(connection: ProviderConnection): Promise<SnoozeCapability>;
  hide(
    connection: ProviderConnection,
    plan: SnoozeProviderPlan,
  ): Promise<SnoozeProviderOperationResult>;
  inspect(
    connection: ProviderConnection,
    plan: SnoozeProviderPlan,
  ): Promise<SnoozeProviderInspection>;
  preflight(
    connection: ProviderConnection,
    input: SnoozePreflightInput,
  ): Promise<SnoozePreflightResult>;
  restore(
    connection: ProviderConnection,
    plan: SnoozeProviderPlan,
  ): Promise<SnoozeProviderOperationResult>;
}

let installed: SnoozeOperationPort | null = null;

export const installSnoozeOperationPort = (port: SnoozeOperationPort): void => {
  installed = port;
};

export const getSnoozeOperationPort = (): SnoozeOperationPort => {
  if (!installed) throw new SnoozeProviderError("terminal", "Snooze is unavailable.");
  return installed;
};
