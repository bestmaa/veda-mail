"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import { MessageFrameConnector } from "@/presentation/features/mail-workspace/connectors/message-frame.connector";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import {
  hasSanitizedHtmlQuote,
  splitPlainMessageContent,
} from "@/presentation/features/mail-workspace/message-quoted-content";

export const MessageBodyConnector = ({
  body,
  handleSessionFailure,
  htmlBody,
  messageId,
  sessionScope,
}: {
  readonly body: string;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly htmlBody: string | null;
  readonly messageId: string;
  readonly sessionScope: string;
}) => {
  const [showQuoted, setShowQuoted] = useState(false);
  const plain = splitPlainMessageContent(body);
  const hasQuote = htmlBody
    ? hasSanitizedHtmlQuote(htmlBody)
    : plain.quoted.length > 0;
  return (
    <div className="mail-body py-7 text-[15px] leading-7 text-slate-700">
      {htmlBody ? (
        <MessageFrameConnector
          collapseQuotes={hasQuote && !showQuoted}
          handleSessionFailure={handleSessionFailure}
          messageId={messageId}
          sanitizedHtml={htmlBody}
          sessionScope={sessionScope}
        />
      ) : (
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {plain.visible}
          {showQuoted && plain.quoted ? `\n\n${plain.quoted}` : ""}
        </div>
      )}
      {hasQuote ? (
        <button
          aria-expanded={showQuoted}
          className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
          onClick={() => setShowQuoted((current) => !current)}
          type="button"
        >
          {showQuoted ? <ChevronUp aria-hidden size={15} /> : <ChevronDown aria-hidden size={15} />}
          {showQuoted ? "Hide quoted content" : "Show quoted content"}
        </button>
      ) : null}
    </div>
  );
};
