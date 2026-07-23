import { LoaderCircle, Save, ShieldCheck } from "lucide-react";

import type { AdminMailServiceViewProps } from "@/presentation/features/admin-mail-service/admin-mail-service.view-model";
import { MailServiceFieldView } from "@/presentation/features/admin-mail-service/ui/mail-service-field.view";

type FormProps = Pick<
  AdminMailServiceViewProps,
  | "allowedDomains"
  | "allowedDomainsInput"
  | "displayName"
  | "displayNameInput"
  | "error"
  | "fields"
  | "isSaving"
  | "onSubmit"
  | "saveLabel"
  | "success"
>;

export const MailServiceFormView = ({
  allowedDomains,
  allowedDomainsInput,
  displayName,
  displayNameInput,
  error,
  fields,
  isSaving,
  onSubmit,
  saveLabel,
  success,
}: FormProps) => (
  <form
    aria-busy={isSaving}
    className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
    onSubmit={onSubmit}
  >
    <div>
      <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-indigo-500">
        Service configuration
      </p>
      <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.04em] text-slate-900">
        Connection details
      </h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">
        These values apply to the organization. Members only enter their own
        mailbox credentials.
      </p>
    </div>

    <div className="mt-6 space-y-5">
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold text-slate-700">
          Display name
        </span>
        <input
          className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          onChange={displayNameInput}
          placeholder="Organization mail"
          required
          type="text"
          value={displayName}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-bold text-slate-700">
          Allowed email domains
        </span>
        <textarea
          className="min-h-28 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          onChange={allowedDomainsInput}
          placeholder={"vedaconcepts.com\nexample.org"}
          required
          value={allowedDomains}
        />
        <span className="mt-1.5 block text-[11px] leading-4 text-slate-400">
          Enter one domain per line. Member sign-in is limited to this list.
        </span>
      </label>

      {fields.map((field) => (
        <MailServiceFieldView field={field} key={field.name} />
      ))}
    </div>

    {error ? (
      <p
        className="mt-5 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700"
        role="alert"
      >
        {error}
      </p>
    ) : null}
    {success ? (
      <p
        className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700"
        role="status"
      >
        <ShieldCheck aria-hidden size={15} />
        {success}
      </p>
    ) : null}

    <div className="mt-6 flex justify-end border-t border-slate-100 pt-5">
      <button
        className="flex h-11 items-center gap-2 rounded-xl bg-[#2f3274] px-5 text-sm font-bold text-white transition hover:bg-[#25285f] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSaving}
        type="submit"
      >
        {isSaving ? (
          <LoaderCircle aria-hidden className="animate-spin" size={17} />
        ) : (
          <Save aria-hidden size={17} />
        )}
        <span aria-live="polite">{saveLabel}</span>
      </button>
    </div>
  </form>
);
