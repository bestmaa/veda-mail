import "server-only";

import type { ProviderConnection } from "@/domain/provider/provider";
import { resolveGateway } from "@/server/mail/gateway-cache";

export interface CalendarEventOwner {
  readonly email: string;
  readonly providerId: string;
}

export const calendarEventOwnerForConnection = async (
  connection: ProviderConnection,
): Promise<CalendarEventOwner> => ({
  email: (await (await resolveGateway(connection)).getAccount()).email,
  providerId: connection.providerId,
});
