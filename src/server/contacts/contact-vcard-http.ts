import "server-only";

import { VCardError } from "@/server/contacts/contact-vcard";
import { ApiError } from "@/transport/http/api-error";

export const asVCardApiError = (error: unknown): unknown =>
  error instanceof VCardError
    ? new ApiError(error.message, "CONTACT_VCARD_INVALID", 422)
    : error;
