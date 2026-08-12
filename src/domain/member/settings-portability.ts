import type { MessageListPreferences } from "@/domain/mail/message-list-preferences";
import type {
  MailRuleAction,
  MailRuleCondition,
} from "@/domain/mail/rule";
import type { MailboxRole } from "@/domain/mail/mailbox";

export const SETTINGS_PORTABILITY_FORMAT = "veda-mail/settings" as const;
export const SETTINGS_PORTABILITY_VERSION = 1 as const;
export const MAX_SETTINGS_PORTABILITY_BYTES = 128 * 1024;

export type PortableMailboxTarget =
  | {
      readonly role: Exclude<MailboxRole, "custom">;
      readonly type: "role";
    }
  | {
      readonly path: readonly string[];
      readonly type: "path";
    };

export type PortableMailRuleAction =
  | Exclude<MailRuleAction, { readonly kind: "label" | "move" }>
  | { readonly kind: "label"; readonly name: string }
  | { readonly kind: "move"; readonly target: PortableMailboxTarget };

export interface PortableMailRule {
  readonly actions: readonly PortableMailRuleAction[];
  readonly conditions: readonly MailRuleCondition[];
  readonly enabled: boolean;
  readonly match: "all" | "any";
  readonly name: string;
  readonly stopProcessing: boolean;
}

export interface SettingsPortabilityBundle {
  readonly exportedAt: string;
  readonly format: typeof SETTINGS_PORTABILITY_FORMAT;
  readonly preferences: MessageListPreferences;
  readonly rules: readonly PortableMailRule[];
  readonly version: typeof SETTINGS_PORTABILITY_VERSION;
}
