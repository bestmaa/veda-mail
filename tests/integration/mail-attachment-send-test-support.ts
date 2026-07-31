import { PUT as upload } from "@/app/api/v1/mail/attachments/[attachmentId]/route";
import { POST as reserve } from "@/app/api/v1/mail/attachments/route";
import { POST as send } from "@/app/api/v1/mail/send/route";
import type { ProviderConnection } from "@/domain/provider/provider";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const mutationHeaders = { host: "mail.example.com", origin };
const route = (attachmentId: string) => ({
  params: Promise.resolve({ attachmentId }),
});

export const sendDraft = (
  connection: ProviderConnection,
  draftId: string,
  attachmentId: string,
  to = [{ email: "recipient@example.com", name: null }],
) =>
  send(
    new Request(`${origin}/api/v1/mail/send`, {
      body: JSON.stringify({
        attachmentIds: [attachmentId],
        body: "Retry-safe attachment.",
        draftId,
        subject: "Retry",
        to,
      }),
      headers: {
        ...mutationHeaders,
        "content-type": "application/json",
        "x-veda-mail-session-scope": mailSessionScope(connection),
      },
      method: "POST",
    }),
  );

export const reserveAndUpload = async (connection: ProviderConnection) => {
  const draftId = crypto.randomUUID();
  const content = "retryable bytes";
  const size = Buffer.byteLength(content);
  const reserved = await reserve(
    new Request(`${origin}/api/v1/mail/attachments`, {
      body: JSON.stringify({
        declaredMimeType: "text/plain",
        draftId,
        fileName: "retry.txt",
        size,
      }),
      headers: {
        ...mutationHeaders,
        "content-type": "application/json",
        "x-veda-mail-session-scope": mailSessionScope(connection),
      },
      method: "POST",
    }),
  );
  if (reserved.status !== 201) {
    throw new Error(`Attachment reservation failed with ${reserved.status}.`);
  }
  const payload = (await reserved.json()) as { data: { id: string } };
  const uploaded = await upload(
    new Request(`${origin}/api/v1/mail/attachments/${payload.data.id}`, {
      body: content,
      headers: {
        ...mutationHeaders,
        "content-length": String(size),
        "content-type": "text/plain",
        "x-veda-draft-id": draftId,
        "x-veda-mail-session-scope": mailSessionScope(connection),
      },
      method: "PUT",
    }),
    route(payload.data.id),
  );
  if (uploaded.status !== 200) {
    throw new Error(`Attachment upload failed with ${uploaded.status}.`);
  }
  return { attachmentId: payload.data.id, draftId };
};
