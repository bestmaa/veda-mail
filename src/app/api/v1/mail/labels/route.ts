import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { labelCatalogStore } from "@/server/labels/label-catalog.store";
import { labelHttpError } from "@/server/labels/label-http";
import { getMailService } from "@/server/mail/mail-service";
import { mailboxOwner } from "@/server/mailboxes/mailbox-http";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { createLabelSchema, updateLabelSchema } from "@/transport/http/label.schema";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 16 * 1_024;

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "label-catalog", 5_000, 300, 60 * 1_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("label-catalog", connection.id, 30, 15 * 60 * 1_000);
    const owner = await mailboxOwner(await getMailService(connection));
    const payload = createLabelSchema.parse(
      await readJsonBody(request, MAX_REQUEST_BYTES),
    );
    return apiSuccess({ labels: await labelCatalogStore.create(owner, payload) }, {
      status: 201,
    });
  } catch (error) {
    return apiFailure(labelHttpError(error), "Unable to create this label.");
  }
};

export const PATCH = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "label-catalog", 5_000, 300, 60 * 1_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("label-catalog", connection.id, 30, 15 * 60 * 1_000);
    const owner = await mailboxOwner(await getMailService(connection));
    const payload = updateLabelSchema.parse(
      await readJsonBody(request, MAX_REQUEST_BYTES),
    );
    return apiSuccess({
      labels: await labelCatalogStore.update(owner, payload.labelId, {
        ...(payload.color === undefined ? {} : { color: payload.color }),
        ...(payload.name === undefined ? {} : { name: payload.name }),
      }),
    });
  } catch (error) {
    return apiFailure(labelHttpError(error), "Unable to update this label.");
  }
};
