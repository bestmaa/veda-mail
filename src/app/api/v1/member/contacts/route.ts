import {
  MAX_CONTACT_REQUEST_BYTES,
} from "@/domain/member/contact";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { contactOwnerForConnection } from "@/server/contacts/contact-owner";
import { parseContactPutOperation } from "@/server/contacts/contact-schema";
import { contactStore } from "@/server/contacts/contact-store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    await assertRequestRateLimit(
      request,
      "member-contact-read",
      10_000,
      600,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit(
      "member-contact-read",
      connection.id,
      120,
      60 * 1000,
    );
    return apiSuccess(
      await contactStore.get(await contactOwnerForConnection(connection)),
    );
  } catch (error) {
    return apiFailure(error, "Unable to load contacts.");
  }
};

export const PUT = async (request: Request) => {
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(
      request,
      "member-contact-write",
      5_000,
      300,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit(
      "member-contact-write",
      connection.id,
      30,
      15 * 60 * 1000,
    );
    const operation = parseContactPutOperation(
      await readJsonBody(request, MAX_CONTACT_REQUEST_BYTES),
    );
    const book = await contactStore.put(
      await contactOwnerForConnection(connection),
      operation,
    );
    const isCreate = operation.operation === "import-contacts" ||
      operation.operation === "create-contact" ||
      operation.operation === "create-group";
    return apiSuccess(book, { status: isCreate ? 201 : 200 });
  } catch (error) {
    return apiFailure(error, "Unable to update contacts.");
  }
};
