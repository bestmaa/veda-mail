import type { SetupFieldViewModel } from "@/presentation/features/setup/setup-wizard.view-model";

export const SetupProviderFieldView = ({
  field,
}: {
  readonly field: SetupFieldViewModel;
}) => (
  <label className="block">
    <span className="mb-2 block text-xs font-bold text-slate-700">
      {field.label}
      {field.required ? <span className="ml-1 text-red-500">*</span> : null}
    </span>
    {field.kind === "select" ? (
      <select className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={field.onChange} required={field.required} value={field.value}>
        {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    ) : (
      <input className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" onChange={field.onChange} placeholder={field.placeholder} required={field.required} type={field.kind} value={field.value} />
    )}
    {field.help ? <span className="mt-1.5 block text-[11px] leading-4 text-slate-400">{field.help}</span> : null}
  </label>
);
