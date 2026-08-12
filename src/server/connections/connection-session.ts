import "server-only";

import { cookies } from "next/headers";

import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { mailServiceProfileRevision } from "@/server/mail-service/mail-service-profile-revision";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import { ApiError } from "@/transport/http/api-error";

export const CONNECTION_COOKIE = "veda_mail_connection";

export const getCurrentConnection = async (): Promise<ProviderConnection> => {
  const cookieStore = await cookies();
  const connectionId = cookieStore.get(CONNECTION_COOKIE)?.value;
  if (!connectionId) {
    throw new ApiError(
      "Sign in with your mailbox account.",
      "MEMBER_SESSION_REQUIRED",
      401,
    );
  }
  const typedId = id.connection(connectionId);
  const stored = await connectionStore.getAsync(typedId);
  if (!stored) {
    throw new ApiError(
      "This mail connection expired. Connect the account again.",
      "MEMBER_SESSION_EXPIRED",
      401,
    );
  }
  const profile = await mailServiceProfileStore.get();
  if (
    !profile ||
    stored.profileRevision !== mailServiceProfileRevision(profile)
  ) {
    await connectionStore.removeAsync(typedId);
    throw new ApiError(
      "Mail-service settings changed. Sign in again.",
      "MEMBER_SESSION_EXPIRED",
      401,
    );
  }
  return stored.connection;
};
