import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { asDraftDomainApiError } from "@/server/mail/draft-http";
import { getMailService } from "@/server/mail/mail-service";
import {
  assertSavedDraftMailPolicy,
  getMailContentPolicy,
} from "@/server/organization/mail-content-policy.service";
import {
  assertSchedulableProviderDraft,
  canonicalScheduledRequest,
  scheduledMessageOwner,
} from "@/server/scheduled-send/scheduled-send-http";
import { scheduledSendStore } from "@/server/scheduled-send/scheduled-send-store";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { createScheduledSendSchema } from "@/transport/http/scheduled-send.schema";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 1024 * 1024;

export const GET = async (request: Request) => {
  try {
    assertRequestRateLimit(request, "scheduled-send-read", 10_000, 600, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("scheduled-send-read", connection.id, 120, 60_000);
    return apiSuccess(
      await scheduledSendStore.list(await scheduledMessageOwner(connection)),
    );
  } catch (error) {
    return apiFailure(error, "Unable to load scheduled messages.");
  }
};

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "scheduled-send-write", 5_000, 300, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("scheduled-send-write", connection.id, 30, 60_000);
    const parsed = createScheduledSendSchema.parse(
      await readJsonBody(request, MAX_REQUEST_BYTES),
    );
    assertSubjectRateLimit(
      "scheduled-send-recipient",
      connection.id,
      300,
      60_000,
      parsed.request.to.length + parsed.request.cc.length + parsed.request.bcc.length,
    );
    const durableRequest = canonicalScheduledRequest({
      bcc: parsed.request.bcc,
      body: parsed.request.body,
      cc: parsed.request.cc,
      draftId: parsed.request.draftId,
      expectedDraftRevision: parsed.request.expectedDraftRevision!,
      ...(parsed.request.htmlBody ? { htmlBody: parsed.request.htmlBody } : {}),
      ...(parsed.request.inReplyTo ? { inReplyTo: parsed.request.inReplyTo } : {}),
      providerDraftId: parsed.request.providerDraftId!,
      subject: parsed.request.subject,
      to: parsed.request.to,
    });
    const draft = await (
      await getMailService(connection)
    ).getDraft(durableRequest.providerDraftId);
    assertSchedulableProviderDraft(draft, durableRequest);
    assertSavedDraftMailPolicy(await getMailContentPolicy(), draft);
    return apiSuccess(
      await scheduledSendStore.schedule({
        connection,
        owner: await scheduledMessageOwner(connection),
        purpose: parsed.purpose,
        request: durableRequest,
        scheduledAt: parsed.scheduledAt,
      }),
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(
      asDraftDomainApiError(error) ?? error,
      "Unable to schedule this message.",
    );
  }
};
