import { MAX_SAVED_SEARCH_REQUEST_BYTES } from "@/domain/mail/saved-search";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { parseSavedSearchPutOperation } from "@/server/saved-searches/saved-search-schema";
import { savedSearchOwnerForConnection } from "@/server/saved-searches/saved-search-owner";
import { savedSearchStore } from "@/server/saved-searches/saved-search-store";
import { assertRequestRateLimit, assertSubjectRateLimit } from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";
export const GET = async (request: Request) => {
  try {
    await assertRequestRateLimit(
      request,
      "member-saved-search-read",
      10_000,
      600,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit(
      "member-saved-search-read",
      connection.id,
      120,
      60 * 1000,
    );
    return apiSuccess(
      await savedSearchStore.get(
        await savedSearchOwnerForConnection(connection),
      ),
    );
  } catch (error) {
    return apiFailure(error, "Unable to load saved searches.");
  }
};
export const PUT = async (request: Request) => {
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(
      request,
      "member-saved-search-write",
      5_000,
      300,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit(
      "member-saved-search-write",
      connection.id,
      30,
      15 * 60 * 1000,
    );
    const operation = parseSavedSearchPutOperation(
      await readJsonBody(request, MAX_SAVED_SEARCH_REQUEST_BYTES),
    );
    const book = await savedSearchStore.put(
      await savedSearchOwnerForConnection(connection),
      operation,
    );
    return apiSuccess(book, {
      status: operation.operation === "create" ? 201 : 200,
    });
  } catch (error) {
    return apiFailure(error, "Unable to update saved searches.");
  }
};
