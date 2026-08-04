import type { MailRuleAction, RuleActionCapability } from "@/domain/mail/rule";
import type { MailRuleChoice } from "@/presentation/features/mail-workspace/mail-rules.view-model";

const fieldClass = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

const actionFor = (kind: RuleActionCapability, mailboxes: readonly MailRuleChoice[], labels: readonly MailRuleChoice[]): MailRuleAction | null => {
  if (kind === "move") return mailboxes[0] ? { kind, mailboxId: mailboxes[0].id as never } : null;
  if (kind === "label") return labels[0] ? { kind, labelId: labels[0].id as never } : null;
  return { kind };
};

const actionLabel: Record<RuleActionCapability, string> = {
  discard: "Discard", label: "Apply label", "mark-read": "Mark as read", move: "Move to mailbox", star: "Star",
};

export const MailRulesActionView = ({ action, index, labels, mailboxes, onRemove, onUpdate, supported }: {
  readonly action: MailRuleAction; readonly index: number;
  readonly labels: readonly MailRuleChoice[]; readonly mailboxes: readonly MailRuleChoice[];
  readonly onRemove: () => void; readonly onUpdate: (action: MailRuleAction) => void;
  readonly supported: readonly RuleActionCapability[];
}) => (
  <fieldset className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <legend className="sr-only">Action {index + 1}</legend>
    <select aria-label={`Action ${index + 1} type`} className={fieldClass} onChange={(event) => {
      const next = actionFor(event.target.value as RuleActionCapability, mailboxes, labels); if (next) onUpdate(next);
    }} value={action.kind}>
      {supported.map((kind) => <option key={kind} value={kind}>{actionLabel[kind]}</option>)}
    </select>
    {action.kind === "move" ? <select aria-label="Destination mailbox" className={`${fieldClass} min-w-40 flex-1`} onChange={(event) => onUpdate({ kind: "move", mailboxId: event.target.value as never })} value={action.mailboxId}>
      {mailboxes.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
    </select> : null}
    {action.kind === "label" ? <select aria-label="Label" className={`${fieldClass} min-w-40 flex-1`} onChange={(event) => onUpdate({ kind: "label", labelId: event.target.value as never })} value={action.labelId}>
      {labels.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
    </select> : null}
    <button aria-label={`Remove action ${index + 1}`} className="ml-auto h-9 rounded-lg px-2 text-xs font-bold text-rose-600 hover:bg-rose-50" onClick={onRemove} type="button">Remove</button>
  </fieldset>
);
