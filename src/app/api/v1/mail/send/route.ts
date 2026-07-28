import { getMailService } from "@/server/mail/mail-service";
import type { ComposeInput } from "@/domain/mail/mail";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { sendMessageSchema } from "@/transport/http/request-schemas";

export const runtime = "nodejs";

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "mail-send", 5_000, 300, 60 * 1000);
    const connection = await getCurrentConnection();
    assertSubjectRateLimit("mail-send", connection.id, 30, 60 * 1000);
    const parsed = sendMessageSchema.parse(await readJsonBody(request));
    const input: ComposeInput = {
      bcc: parsed.bcc,
      body: parsed.body,
      cc: parsed.cc,
      ...(parsed.inReplyTo ? { inReplyTo: parsed.inReplyTo } : {}),
      subject: parsed.subject,
      to: parsed.to,
    };
    const receipt = await (await getMailService(connection)).sendMessage(input);
    return apiSuccess(receipt, { status: 201 });
  } catch (error) {
    return apiFailure(error, "Unable to send this message.");
  }
};
