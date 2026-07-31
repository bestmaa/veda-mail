import type { EmailSignatureOwner } from "@/domain/member/email-signature";
import type { ProviderConnection } from "@/domain/provider/provider";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { parseEmailSignaturePutOperation } from "@/server/signatures/email-signature.schema";
import { emailSignatureStore } from "@/server/signatures/email-signature.store";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { MAX_EMAIL_SIGNATURE_REQUEST_BYTES } from "@/domain/member/email-signature";

export const runtime = "nodejs";

const ownerFor = async (
  connection: ProviderConnection,
): Promise<EmailSignatureOwner> => ({
  email: (await (await resolveGateway(connection)).getAccount()).email,
  providerId: connection.providerId,
});

export const GET = async (request: Request) => {
  try {
    assertRequestRateLimit(
      request,
      "member-signature-read",
      10_000,
      600,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "member-signature-read",
      connection.id,
      120,
      60 * 1000,
    );
    return apiSuccess(
      await emailSignatureStore.get(await ownerFor(connection)),
    );
  } catch (error) {
    return apiFailure(error, "Unable to load email signatures.");
  }
};

export const PUT = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "member-signature-write",
      5_000,
      300,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "member-signature-write",
      connection.id,
      20,
      15 * 60 * 1000,
    );
    const operation = parseEmailSignaturePutOperation(
      await readJsonBody(request, MAX_EMAIL_SIGNATURE_REQUEST_BYTES),
    );
    const book = await emailSignatureStore.put(
      await ownerFor(connection),
      operation,
    );
    return apiSuccess(book, {
      status: operation.operation === "create" ? 201 : 200,
    });
  } catch (error) {
    return apiFailure(error, "Unable to update email signatures.");
  }
};
