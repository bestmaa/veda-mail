import "server-only";

import type { VacationResponseUpdate } from "@/domain/mail/vacation";
import type { ProviderConnection } from "@/domain/provider/provider";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { ApiError } from "@/transport/http/api-error";

export const updateVacationResponse = async (
  connection: ProviderConnection,
  input: VacationResponseUpdate,
) => {
  const gateway = await resolveGateway(connection);
  const capability = await gateway.getVacationCapability();
  if (!capability.supported) {
    throw new ApiError(
      "Automatic replies are unavailable for this provider.",
      "VACATION_PROVIDER_UNSUPPORTED",
      422,
    );
  }
  return gateway.updateVacationResponse(input);
};
