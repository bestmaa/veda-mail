import type { MailServiceFieldViewModel } from "@/presentation/features/admin-mail-service/admin-mail-service.view-model";

export const MailServiceFieldView = ({
  field,
}: {
  readonly field: MailServiceFieldViewModel;
}) => (
  <label className="block">
    <span className="mb-1.5 flex items-center gap-1 text-xs font-bold text-slate-700">
      {field.label}
      {field.required ? <span className="text-[#ff785a]">*</span> : null}
    </span>
    {field.kind === "select" ? (
      <select
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        onChange={field.onChange}
        required={field.required}
        value={field.value}
      >
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ) : (
      <input
        autoComplete={field.autocomplete}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        onChange={field.onChange}
        placeholder={field.placeholder}
        required={field.required}
        type={field.kind}
        value={field.value}
      />
    )}
    {field.help ? (
      <span className="mt-1.5 block text-[11px] leading-4 text-slate-400">
        {field.help}
      </span>
    ) : null}
  </label>
);
