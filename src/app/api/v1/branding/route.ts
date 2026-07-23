import { installationStore } from "@/server/installation/installation.store";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async () => {
  try {
    return apiSuccess(await installationStore.getBranding(), {
      headers: { "Cache-Control": "public, max-age=60, must-revalidate" },
    });
  } catch (error) {
    return apiFailure(error, "Unable to load branding.");
  }
};
