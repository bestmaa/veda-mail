import { MAX_MAIL_RULE_REQUEST_BYTES } from "@/domain/mail/rule";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { previewMailRules } from "@/server/rules/rule-preview.service";
import { parseMailRulePreviewInput } from "@/server/rules/rule-schema";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "member-rule-preview", 5_000, 60, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("member-rule-preview", connection.id, 20, 15 * 60_000);
    const input = parseMailRulePreviewInput(
      await readJsonBody(request, MAX_MAIL_RULE_REQUEST_BYTES),
    );
    return apiSuccess(await previewMailRules(connection, input));
  } catch (error) {
    return apiFailure(error, "Unable to preview mail rules.");
  }
};
