import type {
  MailRule,
  MailRuleAction,
  MailRuleCondition,
  MailRuleDefinition,
  RuleCapability,
} from "@/domain/mail/rule";

export interface MailRuleChoice {
  readonly id: string;
  readonly label: string;
}

export interface MailRuleEditorViewModel {
  readonly definition: MailRuleDefinition;
  readonly editingRuleId: string | null;
  readonly isOpen: boolean;
  readonly onAddAction: (kind: MailRuleAction["kind"]) => void;
  readonly onAddCondition: (kind: MailRuleCondition["kind"]) => void;
  readonly onCancel: () => void;
  readonly onChange: (patch: Partial<MailRuleDefinition>) => void;
  readonly onRemoveAction: (index: number) => void;
  readonly onRemoveCondition: (index: number) => void;
  readonly onSubmit: () => void;
  readonly onUpdateAction: (index: number, action: MailRuleAction) => void;
  readonly onUpdateCondition: (index: number, condition: MailRuleCondition) => void;
}

export interface MailRulePreviewItemViewModel {
  readonly actions: string;
  readonly from: string;
  readonly matchedRules: string;
  readonly messageId: string;
  readonly receivedAt: string;
  readonly subject: string;
}

export interface MailRulesViewModel {
  readonly capability: RuleCapability | null;
  readonly deploymentStatus: string;
  readonly editor: MailRuleEditorViewModel;
  readonly error: string | null;
  readonly isBusy: boolean;
  readonly isLoading: boolean;
  readonly labels: readonly MailRuleChoice[];
  readonly mailboxes: readonly MailRuleChoice[];
  readonly onCreate: () => void;
  readonly onDelete: (ruleId: string) => void;
  readonly onEdit: (rule: MailRule) => void;
  readonly onMove: (ruleId: string, direction: -1 | 1) => void;
  readonly preview: {
    readonly error: string | null;
    readonly hasRun: boolean;
    readonly isLoading: boolean;
    readonly items: readonly MailRulePreviewItemViewModel[];
    readonly onRun: () => void;
  };
  readonly onReconcile: () => void;
  readonly onRetry: () => void;
  readonly onToggle: (ruleId: string, enabled: boolean) => void;
  readonly rules: readonly MailRule[];
  readonly success: string | null;
}
