import { CircleCheckBig, CircleDashed } from "lucide-react";

import type { MailServiceStatusViewModel } from "@/presentation/features/admin-mail-service/admin-mail-service.view-model";

export const MailServiceStatusView = ({
  status,
}: {
  readonly status: MailServiceStatusViewModel;
}) => (
  <section
    className={`rounded-2xl border p-4 ${
      status.tone === "success"
        ? "border-emerald-100 bg-emerald-50/80"
        : "border-slate-200 bg-slate-50"
    }`}
  >
    <p
      className={`flex items-center gap-2 text-sm font-extrabold ${
        status.tone === "success" ? "text-emerald-700" : "text-slate-600"
      }`}
    >
      {status.tone === "success" ? (
        <CircleCheckBig aria-hidden size={17} />
      ) : (
        <CircleDashed aria-hidden size={17} />
      )}
      {status.label}
    </p>
    <p className="mt-1 text-xs leading-5 text-slate-500">
      {status.description}
    </p>
  </section>
);
