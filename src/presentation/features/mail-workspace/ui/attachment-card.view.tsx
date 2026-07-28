import { File } from "lucide-react";

import type { AttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const AttachmentCardView = ({
  attachment,
}: {
  readonly attachment: AttachmentViewModel;
}) => (
  <div className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3 text-left">
    <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-500">
      <File aria-hidden size={17} />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-bold text-slate-700">
        {attachment.name}
      </span>
      <span className="block truncate text-xs text-slate-600">
        {attachment.meta}
      </span>
    </span>
  </div>
);
