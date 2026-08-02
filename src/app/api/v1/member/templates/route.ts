import {
  MAX_EMAIL_TEMPLATE_REQUEST_BYTES,
  type EmailTemplateOwner,
} from "@/domain/member/email-template";
import type { ProviderConnection } from "@/domain/provider/provider";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { parseEmailTemplatePutOperation } from "@/server/templates/email-template.schema";
import { emailTemplateStore } from "@/server/templates/email-template.store";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const ownerFor = async (
  connection: ProviderConnection,
): Promise<EmailTemplateOwner> => ({
  email: (await (await resolveGateway(connection)).getAccount()).email,
  providerId: connection.providerId,
});

export const GET = async (request: Request) => {
  try {
    assertRequestRateLimit(
      request,
      "member-template-read",
      10_000,
      600,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "member-template-read",
      connection.id,
      120,
      60 * 1000,
    );
    return apiSuccess(await emailTemplateStore.get(await ownerFor(connection)));
  } catch (error) {
    return apiFailure(error, "Unable to load email templates.");
  }
};

export const PUT = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "member-template-write",
      5_000,
      300,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "member-template-write",
      connection.id,
      20,
      15 * 60 * 1000,
    );
    const operation = parseEmailTemplatePutOperation(
      await readJsonBody(request, MAX_EMAIL_TEMPLATE_REQUEST_BYTES),
    );
    const book = await emailTemplateStore.put(
      await ownerFor(connection),
      operation,
    );
    return apiSuccess(book, {
      status: operation.operation === "create" ? 201 : 200,
    });
  } catch (error) {
    return apiFailure(error, "Unable to update email templates.");
  }
};
