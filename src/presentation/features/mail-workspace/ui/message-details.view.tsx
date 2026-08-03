import type { ReaderViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

type MessageDetails = ReaderViewModel["details"];

const DetailRow = ({ label, value }: {
  readonly label: string;
  readonly value: string;
}) => (
  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
    <dt className="font-bold text-slate-600">{label}</dt>
    <dd className="min-w-0 break-words text-slate-700">{value}</dd>
  </div>
);

export const MessageDetailsView = ({ details }: {
  readonly details: MessageDetails;
}) => (
  <details className="mt-2 text-xs">
    <summary className="w-fit cursor-pointer rounded text-indigo-700 outline-none hover:text-indigo-900 focus-visible:ring-2 focus-visible:ring-indigo-500">
      Message details
    </summary>
    <dl className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <DetailRow label="From" value={details.from} />
      <DetailRow label="To" value={details.to} />
      {details.cc ? <DetailRow label="Cc" value={details.cc} /> : null}
      {details.replyTo ? (
        <DetailRow label="Reply-To" value={details.replyTo} />
      ) : null}
      <DetailRow label="Date" value={details.date} />
      <DetailRow label="Size" value={details.messageSize} />
      <DetailRow label="Attachments" value={details.attachments} />
      {details.conversationPosition ? (
        <DetailRow
          label="Conversation"
          value={details.conversationPosition}
        />
      ) : null}
    </dl>
  </details>
);
