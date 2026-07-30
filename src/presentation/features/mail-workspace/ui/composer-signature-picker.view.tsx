import { PenLine } from "lucide-react";

import type { ComposerSignaturePickerViewModel } from "@/presentation/features/mail-workspace/composer-signature-picker.view-model";

export const ComposerSignaturePickerView = ({
  picker,
}: {
  readonly picker: ComposerSignaturePickerViewModel;
}) => (
  <label className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-600">
    <PenLine aria-hidden size={14} />
    <span>Signature</span>
    <select
      aria-label="Email signature"
      className="min-w-0 max-w-40 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      disabled={picker.disabled}
      onChange={picker.onChange}
      value={picker.selectedId ?? ""}
    >
      <option value="">None</option>
      {picker.options.map((signature) => (
        <option key={signature.id} value={signature.id}>
          {signature.name}
        </option>
      ))}
    </select>
  </label>
);
