import { id } from "@/domain/shared/brand";
import { getMailService } from "@/server/mail/mail-service";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    const params = new URL(request.url).searchParams;
    const mailbox = params.get("mailboxId");
    const cursor = params.get("cursor");
    const search = params.get("search");
    const workspace = await (
      await getMailService()
    ).getWorkspace({
      ...(cursor ? { cursor } : {}),
      limit: 50,
      ...(mailbox ? { mailboxId: id.mailbox(mailbox) } : {}),
      ...(search ? { search: search.slice(0, 200) } : {}),
    });
    return apiSuccess(workspace);
  } catch (error) {
    return apiFailure(error, "Unable to load this mailbox.");
  }
};
