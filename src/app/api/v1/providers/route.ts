import { getProviderRegistry } from "@/bootstrap/provider-registry";
import { assertAdminAccess } from "@/server/auth/admin-session";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async () => {
  try {
    await assertAdminAccess();
    return apiSuccess(getProviderRegistry().list());
  } catch (error) {
    return apiFailure(error);
  }
};
