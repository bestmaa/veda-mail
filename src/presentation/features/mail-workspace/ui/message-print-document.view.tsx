import type { MailAddress } from "@/domain/mail/mail";
import type { MessagePrintDocument } from "@/domain/mail/message-print";
import type { MailLocale } from "@/domain/mail/message-list-preferences";
import {
  formatFileSize,
  formatFullDate,
} from "@/presentation/shared/formatters/mail-formatters";

const addresses = (value: readonly MailAddress[]): string =>
  value.map(({ email, name }) => name ? `${name} <${email}>` : email).join(", ");

export const MessagePrintDocumentView = ({
  document,
  locale,
  timeZone,
}: {
  readonly document: MessagePrintDocument;
  readonly locale: MailLocale;
  readonly timeZone: string;
}) => (
  <section aria-hidden className="veda-print-root">
    <header className="veda-print-heading">
      <p>Veda Mail · {document.scope === "conversation" ? "Conversation" : "Message"}</p>
      <h1>{document.messages[0]?.subject || "(No subject)"}</h1>
      {document.scope === "conversation" ? (
        <p>
          {document.messages.length} of {document.total} messages
          {document.truncated ? " · Safe print limit reached" : ""}
        </p>
      ) : null}
    </header>
    {document.messages.map((message, index) => {
      const attachments = message.attachments.map(({ name, size }) =>
        `${name}${size === null ? "" : ` (${formatFileSize(size, locale)})`}`,
      );
      return (
        <article className="veda-print-message" key={message.id}>
          <header>
            <h2>{message.subject || "(No subject)"}</h2>
            <dl>
              <div><dt>From</dt><dd>{addresses(message.from) || "Unknown sender"}</dd></div>
              <div><dt>To</dt><dd>{addresses(message.to) || "Undisclosed recipients"}</dd></div>
              {message.cc.length ? <div><dt>CC</dt><dd>{addresses(message.cc)}</dd></div> : null}
              {message.replyTo.length ? <div><dt>Reply-To</dt><dd>{addresses(message.replyTo)}</dd></div> : null}
              <div><dt>Date</dt><dd>{formatFullDate(message.receivedAt, locale, timeZone)}</dd></div>
              <div><dt>Size</dt><dd>{formatFileSize(message.size, locale)}</dd></div>
              {attachments.length ? <div><dt>Attachments</dt><dd>{attachments.join(", ")}</dd></div> : null}
            </dl>
          </header>
          {message.htmlBody ? (
            <div
              className="veda-print-body"
              // Provider adapters sanitize this HTML, and the print service
              // sanitizes it again while removing every inline image source.
              dangerouslySetInnerHTML={{ __html: message.htmlBody }}
            />
          ) : (
            <div className="veda-print-body whitespace-pre-wrap">{message.textBody}</div>
          )}
          {index + 1 < document.messages.length ? <hr /> : null}
        </article>
      );
    })}
    {document.truncated ? (
      <p className="veda-print-limit-note">
        This conversation exceeds the safe 100-message print limit. Remaining messages were not included.
      </p>
    ) : null}
  </section>
);
