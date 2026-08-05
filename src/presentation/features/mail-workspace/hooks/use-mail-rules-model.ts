"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  MailRule,
  MailRuleAction,
  MailRuleCondition,
  MailRuleDefinition,
  MailRulePutOperation,
  RuleConditionCapability,
} from "@/domain/mail/rule";
import type {
  MailRuleChoice,
  MailRulePreviewItemViewModel,
  MailRulesViewModel,
} from "@/presentation/features/mail-workspace/mail-rules.view-model";
import {
  appendMailRuleAction,
  definitionFromMailRule,
  replaceMailRuleAction,
} from "@/presentation/features/mail-workspace/mail-rules-editor-state";
import { isCurrentMailRuleRequest } from "@/presentation/features/mail-workspace/mail-rules-request-policy";
import { createMailRulePreviewItems } from "@/presentation/features/mail-workspace/mail-rules-preview";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import {
  memberRuleApi,
  type MailRuleWorkspaceSnapshot,
} from "@/transport/client/member-rule-api";

const emptyDefinition = (): MailRuleDefinition => ({
  actions: [{ kind: "mark-read" }],
  conditions: [{ kind: "subject", operator: "contains", value: "" }],
  enabled: true,
  match: "all",
  name: "",
  stopProcessing: false,
});

const conditionFor = (kind: MailRuleCondition["kind"], supported: readonly RuleConditionCapability[]): MailRuleCondition => {
  if (kind === "address") {
    const field = (["from", "to", "cc", "recipient"] as const).find((item) => supported.includes(item)) ?? "from";
    return { field, kind, operator: "contains", value: "" };
  }
  if (kind === "header") return { kind, name: "", operator: "exists" };
  if (kind === "size") return { bytes: 1_000_000, kind, operator: "over" };
  if (kind === "attachment") return { kind, value: true };
  return { kind, operator: "contains", value: "" };
};

const actionFor = (
  kind: MailRuleAction["kind"],
  mailboxes: readonly MailRuleChoice[],
  labels: readonly MailRuleChoice[],
): MailRuleAction | null => {
  if (kind === "move") {
    return mailboxes[0] ? { kind, mailboxId: mailboxes[0].id as never } : null;
  }
  if (kind === "label") {
    return labels[0] ? { kind, labelId: labels[0].id as never } : null;
  }
  return { kind };
};

export const useMailRulesModel = (
  sessionScope: string,
  mailboxes: readonly MailRuleChoice[],
  labels: readonly MailRuleChoice[],
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
  localization?: { readonly locale: string; readonly timeZone: string },
): MailRulesViewModel => {
  const [snapshot, setSnapshot] = useState<MailRuleWorkspaceSnapshot | null>(null);
  const [definition, setDefinition] = useState<MailRuleDefinition>(emptyDefinition);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<readonly MailRulePreviewItemViewModel[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRan, setPreviewRan] = useState(false);
  const scopeRef = useRef(sessionScope);

  const load = useCallback(async (signal?: AbortSignal, clearStatus = true) => {
    if (!sessionScope) return;
    if (clearStatus) { setError(null); setSuccess(null); }
    setIsLoading(true);
    try {
      const next = await memberRuleApi.get(sessionScope, signal);
      if (scopeRef.current === sessionScope) setSnapshot(next);
    } catch (caught) {
      if (signal?.aborted || scopeRef.current !== sessionScope) return;
      if (!handleSessionFailure(caught)) {
        setError(caught instanceof Error ? caught.message : "Unable to load mail rules.");
      }
    } finally {
      if (scopeRef.current === sessionScope) setIsLoading(false);
    }
  }, [handleSessionFailure, sessionScope]);

  useEffect(() => {
    scopeRef.current = sessionScope;
    setSnapshot(null); setError(null); setSuccess(null); setIsEditorOpen(false);
    setPreviewItems([]); setPreviewError(null); setPreviewLoading(false); setPreviewRan(false);
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, sessionScope]);

  const mutate = useCallback(async (operation: MailRulePutOperation, message: string) => {
    if (!sessionScope) return;
    setIsBusy(true); setError(null); setSuccess(null);
    try {
      const book = await memberRuleApi.put(operation, sessionScope);
      if (scopeRef.current !== sessionScope) return;
      setSnapshot((current) => current ? { ...current, book } : current);
      setPreviewItems([]); setPreviewRan(false);
      setSuccess(message);
      setIsEditorOpen(false);
    } catch (caught) {
      if (scopeRef.current !== sessionScope) return;
      if (!handleSessionFailure(caught)) {
        setError(caught instanceof Error ? caught.message : "Unable to update mail rules.");
        await load(undefined, false);
      }
    } finally {
      if (scopeRef.current === sessionScope) setIsBusy(false);
    }
  }, [handleSessionFailure, load, sessionScope]);

  const rules = snapshot?.book.rules ?? [];
  const revision = snapshot?.book.revision ?? null;
  const editor = {
    definition, editingRuleId, isOpen: isEditorOpen,
    onAddAction: (kind: MailRuleAction["kind"]) => {
      const action = actionFor(kind, mailboxes, labels);
      if (action) setDefinition((current) => appendMailRuleAction(current, action));
    },
    onAddCondition: (kind: MailRuleCondition["kind"]) => setDefinition((current) => ({
      ...current, conditions: [...current.conditions, conditionFor(kind, snapshot?.capability.supportedConditions ?? [])],
    })),
    onCancel: () => setIsEditorOpen(false),
    onChange: (patch: Partial<MailRuleDefinition>) => setDefinition((current) => ({ ...current, ...patch })),
    onRemoveAction: (index: number) => setDefinition((current) => ({
      ...current, actions: current.actions.filter((_, itemIndex) => itemIndex !== index),
    })),
    onRemoveCondition: (index: number) => setDefinition((current) => ({
      ...current, conditions: current.conditions.filter((_, itemIndex) => itemIndex !== index),
    })),
    onSubmit: () => {
      if (!definition.name.trim() || !definition.conditions.length || !definition.actions.length) {
        setError("Add a rule name, at least one condition, and at least one action."); return;
      }
      void mutate(editingRuleId
        ? { definition, expectedRevision: revision, operation: "update", ruleId: editingRuleId }
        : { definition, expectedRevision: revision, operation: "create" },
      editingRuleId ? "Rule updated and deployed." : "Rule created and deployed.");
    },
    onUpdateAction: (index: number, action: MailRuleAction) =>
      setDefinition((current) => replaceMailRuleAction(current, index, action)),
    onUpdateCondition: (index: number, condition: MailRuleCondition) => setDefinition((current) => ({
      ...current, conditions: current.conditions.map((item, itemIndex) => itemIndex === index ? condition : item),
    })),
  };

  return {
    capability: snapshot?.capability ?? null,
    deploymentStatus: snapshot?.book.deployment.status ?? "unknown",
    editor, error, isBusy, isLoading, labels,
    ...(localization ? { locale: localization.locale } : {}),
    mailboxes,
    onCreate: () => { setDefinition(emptyDefinition()); setEditingRuleId(null); setIsEditorOpen(true); setError(null); },
    onDelete: (ruleId) => void mutate({ expectedRevision: revision, operation: "delete", ruleId }, "Rule deleted and deployed."),
    onEdit: (rule: MailRule) => {
      setDefinition(definitionFromMailRule(rule));
      setEditingRuleId(rule.id); setIsEditorOpen(true); setError(null);
    },
    onMove: (ruleId, direction) => {
      const index = rules.findIndex(({ id }) => id === ruleId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= rules.length) return;
      const ruleIds = rules.map(({ id }) => id);
      const currentId = ruleIds[index]!; ruleIds[index] = ruleIds[target]!; ruleIds[target] = currentId;
      void mutate({ expectedRevision: revision, operation: "reorder", ruleIds }, "Rule order updated and deployed.");
    },
    preview: {
      error: previewError, hasRun: previewRan, isLoading: previewLoading,
      items: previewItems,
      onRun: () => {
        if (!sessionScope || !rules.length) return;
        setPreviewLoading(true); setPreviewError(null); setPreviewRan(true);
        void memberRuleApi.preview({ limit: 25, rules }, sessionScope).then((results) => {
          if (!isCurrentMailRuleRequest(scopeRef.current, sessionScope)) return;
          setPreviewItems(createMailRulePreviewItems(results, rules, mailboxes, labels));
        }).catch((caught: unknown) => {
          if (isCurrentMailRuleRequest(scopeRef.current, sessionScope) && !handleSessionFailure(caught)) {
            setPreviewItems([]);
            setPreviewError(caught instanceof Error ? caught.message : "Unable to preview mail rules.");
          }
        }).finally(() => {
          if (isCurrentMailRuleRequest(scopeRef.current, sessionScope)) setPreviewLoading(false);
        });
      },
    },
    onReconcile: () => {
      if (!sessionScope || !revision) return;
      setIsBusy(true); setError(null); setSuccess(null);
      void memberRuleApi.reconcile(revision, sessionScope).then((book) => {
        if (!isCurrentMailRuleRequest(scopeRef.current, sessionScope)) return;
        setSnapshot((current) => current ? { ...current, book } : current);
        setSuccess("Rules reconciled with the provider.");
      }).catch((caught: unknown) => {
        if (isCurrentMailRuleRequest(scopeRef.current, sessionScope) && !handleSessionFailure(caught)) setError(caught instanceof Error ? caught.message : "Reconcile failed.");
      }).finally(() => { if (isCurrentMailRuleRequest(scopeRef.current, sessionScope)) setIsBusy(false); });
    },
    onRetry: () => void load(),
    onToggle: (ruleId, enabled) => void mutate({ enabled, expectedRevision: revision, operation: "toggle", ruleId }, enabled ? "Rule enabled." : "Rule disabled."),
    rules, success,
    ...(localization ? { timeZone: localization.timeZone } : {}),
  };
};
