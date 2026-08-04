import type {
  MailRuleAction,
  MailRuleCondition,
  RuleActionCapability,
  RuleConditionCapability,
} from "@/domain/mail/rule";
import type { MailRulesViewModel } from "@/presentation/features/mail-workspace/mail-rules.view-model";
import { MailRulesActionView } from "@/presentation/features/mail-workspace/ui/mail-rules-action.view";
import { MailRulesConditionView } from "@/presentation/features/mail-workspace/ui/mail-rules-condition.view";

const inputClass = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";
const conditionKinds: readonly { kind: MailRuleCondition["kind"]; capability: RuleConditionCapability; label: string }[] = [
  { capability: "from", kind: "address", label: "Address" },
  { capability: "subject", kind: "subject", label: "Subject" },
  { capability: "header", kind: "header", label: "Header" },
  { capability: "size", kind: "size", label: "Message size" },
  { capability: "attachment", kind: "attachment", label: "Attachment" },
];
const actionLabels: Record<RuleActionCapability, string> = {
  discard: "Discard", label: "Apply label", "mark-read": "Mark as read", move: "Move", star: "Star",
};

export const MailRulesEditorView = ({ rules }: { readonly rules: MailRulesViewModel }) => {
  const { editor } = rules;
  if (!editor.isOpen) return null;
  const supportedConditions = rules.capability?.supportedConditions ?? [];
  const supportedActions = (rules.capability?.supportedActions ?? []).filter((kind) =>
    (kind !== "move" || rules.mailboxes.length > 0) &&
    (kind !== "label" || rules.labels.length > 0));
  return (
    <form className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4" onSubmit={(event) => { event.preventDefault(); editor.onSubmit(); }}>
      <div className="flex items-start justify-between gap-3">
        <div><h4 className="font-bold text-slate-900">{editor.editingRuleId ? "Edit rule" : "Create rule"}</h4><p className="text-xs text-slate-500">Rules run from top to bottom on the mail provider.</p></div>
        <button className="text-xs font-bold text-slate-600 hover:text-slate-900" onClick={editor.onCancel} type="button">Cancel</button>
      </div>
      <label className="block text-xs font-bold text-slate-600">Rule name
        <input autoFocus className={`${inputClass} mt-1.5`} maxLength={80} onChange={(event) => editor.onChange({ name: event.target.value })} required value={editor.definition.name} />
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <label className="text-xs font-bold text-slate-600">Match
          <select className="ml-2 h-9 rounded-lg border border-slate-200 bg-white px-2" onChange={(event) => editor.onChange({ match: event.target.value as "all" | "any" })} value={editor.definition.match}>
            <option value="all">all conditions</option><option value="any">any condition</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input checked={editor.definition.enabled} onChange={(event) => editor.onChange({ enabled: event.target.checked })} type="checkbox" />Enabled</label>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input checked={editor.definition.stopProcessing} onChange={(event) => editor.onChange({ stopProcessing: event.target.checked })} type="checkbox" />Stop later rules</label>
      </div>
      <div className="space-y-2">
        <h5 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Conditions</h5>
        {editor.definition.conditions.map((condition, index) => <MailRulesConditionView condition={condition} index={index} key={`${index}-${condition.kind}`} onRemove={() => editor.onRemoveCondition(index)} onUpdate={(next) => editor.onUpdateCondition(index, next)} />)}
        <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-700">Add condition
          <select aria-label="Add condition" className="h-9 rounded-lg border border-indigo-200 bg-white px-2" defaultValue="" onChange={(event) => { if (event.target.value) editor.onAddCondition(event.target.value as MailRuleCondition["kind"]); event.target.value = ""; }}>
            <option value="" disabled>Select</option>{conditionKinds.filter(({ capability }) => capability === "from"
              ? (["from", "to", "cc", "recipient"] as const).some((field) => supportedConditions.includes(field))
              : supportedConditions.includes(capability)).map(({ kind, label }) => <option key={kind} value={kind}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="space-y-2">
        <h5 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Actions</h5>
        {editor.definition.actions.map((action, index) => <MailRulesActionView action={action} index={index} key={`${index}-${action.kind}`} labels={rules.labels} mailboxes={rules.mailboxes} onRemove={() => editor.onRemoveAction(index)} onUpdate={(next: MailRuleAction) => editor.onUpdateAction(index, next)} supported={supportedActions} />)}
        <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-700">Add action
          <select aria-label="Add action" className="h-9 rounded-lg border border-indigo-200 bg-white px-2" defaultValue="" onChange={(event) => { if (event.target.value) editor.onAddAction(event.target.value as RuleActionCapability); event.target.value = ""; }}>
            <option value="" disabled>Select</option>{supportedActions.map((kind) => <option key={kind} value={kind}>{actionLabels[kind]}</option>)}
          </select>
        </label>
      </div>
      <div className="flex justify-end"><button className="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50" disabled={rules.isBusy} type="submit">{rules.isBusy ? "Deploying..." : "Save and deploy"}</button></div>
    </form>
  );
};
