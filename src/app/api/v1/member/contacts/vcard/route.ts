import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { contactOwnerForConnection } from "@/server/contacts/contact-owner";
import { contactStore } from "@/server/contacts/contact-store";
import {
  exportVCards,
} from "@/server/contacts/contact-vcard";
import { asVCardApiError } from "@/server/contacts/contact-vcard-http";
import {
  importContactVCards,
  MAX_VCARD_IMPORT_REQUEST_BYTES,
} from "@/server/contacts/contact-vcard-import";
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
    assertRequestRateLimit(request, "member-contact-vcard-export", 10_000, 60, 60 * 1000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("member-contact-vcard-export", connection.id, 20, 15 * 60 * 1000);
    const book = await contactStore.get(await contactOwnerForConnection(connection));
    const cards = book.contacts.map((contact) => ({
      categories: book.groups.filter(({ contactIds }) => contactIds.includes(contact.id))
        .map(({ name }) => name),
      displayName: contact.name,
      emails: contact.emails.map(({ email, label }) => ({
        address: email,
        preferred: label === "preferred",
        types: label && label !== "preferred" && /^[a-z0-9-]{1,32}$/iu.test(label)
          ? [label.toLowerCase()] : [],
      })),
      uid: contact.id,
    }));
    const body = cards.length > 0 ? exportVCards(cards) : "";
    return new Response(body, { headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'attachment; filename="veda-mail-contacts.vcf"',
      "Content-Type": "text/vcard; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return apiFailure(asVCardApiError(error), "Unable to export contacts.");
  }
};

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "member-contact-vcard-import", 5_000, 30, 60 * 1000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("member-contact-vcard-import", connection.id, 5, 15 * 60 * 1000);
    const book = await importContactVCards(
      await contactOwnerForConnection(connection),
      await readJsonBody(request, MAX_VCARD_IMPORT_REQUEST_BYTES),
    );
    return apiSuccess(book, { status: 201 });
  } catch (error) {
    return apiFailure(asVCardApiError(error), "Unable to import contacts.");
  }
};
