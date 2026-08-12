import "server-only";

import type { ProviderConnection } from "@/domain/provider/provider";
import type { SettingsPortabilityBundle } from "@/domain/member/settings-portability";
import { labelCatalogStore } from "@/server/labels/label-catalog.store";
import { getMailService } from "@/server/mail/mail-service";
import { mailboxOwner } from "@/server/mailboxes/mailbox-http";
import {
  createSettingsPortabilityBundle,
  resolvePortableRules,
} from "@/server/portability/settings-portability";
import { messageListPreferencesStore } from "@/server/preferences/message-list-preferences.store";
import {
  readRuleWorkspace,
  replaceAndDeployRules,
} from "@/server/rules/rule-deployment.service";
import { ApiError } from "@/transport/http/api-error";

const context = async (connection: ProviderConnection) => {
  const service = await getMailService(connection);
  const owner = await mailboxOwner(service);
  const [labels, mailboxes] = await Promise.all([
    labelCatalogStore.list(owner),
    service.listMailboxes(),
  ]);
  return { labels, mailboxes, owner };
};

export const exportPortableSettings = async (
  connection: ProviderConnection,
): Promise<SettingsPortabilityBundle> => {
  const [{ labels, mailboxes }, preferences, workspace] = await Promise.all([
    context(connection),
    getMailService(connection).then(mailboxOwner).then((owner) =>
      messageListPreferencesStore.get(owner)),
    readRuleWorkspace(connection),
  ]);
  return createSettingsPortabilityBundle({
    labels,
    mailboxes,
    preferences,
    rules: workspace.book.rules,
  });
};

export const importPortableSettings = async (
  connection: ProviderConnection,
  bundle: SettingsPortabilityBundle,
) => {
  const [{ labels, mailboxes, owner }, workspace] = await Promise.all([
    context(connection),
    readRuleWorkspace(connection),
  ]);
  const needsRuleDeployment = bundle.rules.length > 0 ||
    workspace.book.rules.length > 0;
  const samePreferences = await messageListPreferencesStore.get(owner).then(
    (current) => JSON.stringify(current) === JSON.stringify(bundle.preferences),
  );
  if (!workspace.capability.supported && needsRuleDeployment) {
    throw new ApiError(
      workspace.capability.reason ?? "Mail rules are unavailable for this provider.",
      "SETTINGS_IMPORT_RULES_UNSUPPORTED",
      422,
    );
  }
  const definitions = resolvePortableRules({
    labels,
    mailboxes,
    rules: bundle.rules,
  });
  if (!needsRuleDeployment && samePreferences) {
    return { preferences: bundle.preferences, rules: workspace.book };
  }
  const rules = needsRuleDeployment
    ? await replaceAndDeployRules(connection, definitions)
    : workspace.book;
  const preferences = samePreferences
    ? bundle.preferences
    : await messageListPreferencesStore.set(owner, bundle.preferences);
  return { preferences, rules };
};
