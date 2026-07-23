import { id } from "@/domain/shared/brand";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { getMailService } from "@/server/mail/mail-service";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { messageMutationSchema } from "@/transport/http/request-schemas";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly messageId: string }>;
}

export const GET = async (_request: Request, context: RouteContext) => {
  try {
    const { messageId } = await context.params;
    const message = await (
      await getMailService()
    ).getMessage(id.message(messageId));
    return apiSuccess(message);
  } catch (error) {
    return apiFailure(error, "Unable to open this message.");
  }
};

export const PATCH = async (request: Request, context: RouteContext) => {
  try {
    assertSameOrigin(request);
    const { messageId } = await context.params;
    const payload = (await request.json()) as unknown;
    const mutation = messageMutationSchema.parse({
      ...(typeof payload === "object" && payload ? payload : {}),
      messageId,
    });
    await (await getMailService()).mutateMessage(mutation);
    return apiSuccess({ updated: true });
  } catch (error) {
    return apiFailure(error, "Unable to update this message.");
  }
};
