import "server-only";

import { ApiError } from "@/transport/http/api-error";

export class ProviderMessageMutationRejectedError extends ApiError {
  public constructor(message: string) {
    super(message, "PROVIDER_MESSAGE_MUTATION_REJECTED", 409);
    this.name = "ProviderMessageMutationRejectedError";
  }
}
