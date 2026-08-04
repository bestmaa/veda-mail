import type { MailRuleCondition } from "@/domain/mail/rule";

const fieldClass = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

const defaultCondition = (kind: MailRuleCondition["kind"]): MailRuleCondition => {
  if (kind === "address") return { field: "from", kind, operator: "contains", value: "" };
  if (kind === "header") return { kind, name: "", operator: "exists" };
  if (kind === "size") return { bytes: 1_000_000, kind, operator: "over" };
  if (kind === "attachment") return { kind, value: true };
  return { kind, operator: "contains", value: "" };
};

export const MailRulesConditionView = ({
  condition, index, onRemove, onUpdate,
}: {
  readonly condition: MailRuleCondition;
  readonly index: number;
  readonly onRemove: () => void;
  readonly onUpdate: (condition: MailRuleCondition) => void;
}) => (
  <fieldset className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[8rem_1fr_auto]">
    <legend className="sr-only">Condition {index + 1}</legend>
    <select
      aria-label={`Condition ${index + 1} type`}
      className={fieldClass}
      onChange={(event) => onUpdate(defaultCondition(event.target.value as MailRuleCondition["kind"]))}
      value={condition.kind}
    >
      <option value="address">Address</option><option value="subject">Subject</option>
      <option value="header">Header</option><option value="size">Message size</option>
      <option value="attachment">Has attachment</option>
    </select>
    <div className="flex min-w-0 flex-wrap gap-2">
      {condition.kind === "address" ? <>
        <select aria-label="Address field" className={fieldClass} onChange={(event) => onUpdate({ ...condition, field: event.target.value as typeof condition.field })} value={condition.field}>
          <option value="from">From</option><option value="to">To</option><option value="cc">Cc</option><option value="recipient">Envelope recipient</option>
        </select>
        <select aria-label="Address comparison" className={fieldClass} onChange={(event) => onUpdate({ ...condition, operator: event.target.value as typeof condition.operator })} value={condition.operator}>
          <option value="contains">contains</option><option value="is">is exactly</option><option value="domain">has domain</option>
        </select>
        <input aria-label="Address value" className={`${fieldClass} min-w-40 flex-1`} maxLength={256} onChange={(event) => onUpdate({ ...condition, value: event.target.value })} required value={condition.value} />
      </> : null}
      {condition.kind === "subject" ? <>
        <select aria-label="Subject comparison" className={fieldClass} onChange={(event) => onUpdate({ ...condition, operator: event.target.value as typeof condition.operator })} value={condition.operator}>
          <option value="contains">contains</option><option value="is">is exactly</option>
        </select>
        <input aria-label="Subject value" className={`${fieldClass} min-w-40 flex-1`} maxLength={256} onChange={(event) => onUpdate({ ...condition, value: event.target.value })} required value={condition.value} />
      </> : null}
      {condition.kind === "header" ? <>
        <input aria-label="Header name" className={`${fieldClass} min-w-32`} maxLength={64} onChange={(event) => onUpdate({ ...condition, name: event.target.value })} placeholder="X-Header" required value={condition.name} />
        <select aria-label="Header comparison" className={fieldClass} onChange={(event) => {
          const operator = event.target.value as "contains" | "exists" | "is";
          onUpdate(operator === "exists" ? { kind: "header", name: condition.name, operator } : { kind: "header", name: condition.name, operator, value: "value" in condition ? condition.value : "" });
        }} value={condition.operator}>
          <option value="exists">exists</option><option value="contains">contains</option><option value="is">is exactly</option>
        </select>
        {condition.operator !== "exists" ? <input aria-label="Header value" className={`${fieldClass} min-w-36 flex-1`} maxLength={256} onChange={(event) => onUpdate({ ...condition, value: event.target.value })} required value={condition.value} /> : null}
      </> : null}
      {condition.kind === "size" ? <>
        <select aria-label="Size comparison" className={fieldClass} onChange={(event) => onUpdate({ ...condition, operator: event.target.value as typeof condition.operator })} value={condition.operator}>
          <option value="over">over</option><option value="under">under</option>
        </select>
        <input aria-label="Size in bytes" className={fieldClass} min={1} onChange={(event) => onUpdate({ ...condition, bytes: Number(event.target.value) })} required type="number" value={condition.bytes} />
        <span className="self-center text-xs text-slate-500">bytes</span>
      </> : null}
      {condition.kind === "attachment" ? <span className="self-center text-xs font-semibold text-slate-600">Message contains an attachment</span> : null}
    </div>
    <button aria-label={`Remove condition ${index + 1}`} className="h-9 rounded-lg px-2 text-xs font-bold text-rose-600 hover:bg-rose-50" onClick={onRemove} type="button">Remove</button>
  </fieldset>
);
