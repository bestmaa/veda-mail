"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEventHandler,
} from "react";

import type { AdminMailServiceViewProps } from "@/presentation/features/admin-mail-service/admin-mail-service.view-model";
import { useMailServiceFormModel } from "@/presentation/features/admin-mail-service/hooks/use-mail-service-form-model";
import {
  adminMailServiceApi,
  ApiClientError,
} from "@/transport/client/api-client";

const isServiceField = (
  field: NonNullable<
    ReturnType<typeof useMailServiceFormModel>["selectedProvider"]
  >["fields"][number],
): boolean => "scope" in field && field.scope === "service";

const parseDomains = (value: string): readonly string[] => [
  ...new Set(
    value
      .split(/[\s,]+/)
      .map((domain) => domain.trim().toLocaleLowerCase())
      .filter(Boolean),
  ),
];

export const useAdminMailServiceModel = (): AdminMailServiceViewProps => {
  const router = useRouter();
  const form = useMailServiceFormModel();
  const hydrateForm = form.hydrate;
  const [activeName, setActiveName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void adminMailServiceApi
      .get()
      .then((snapshot) => {
        if (!alive) {
          return;
        }
        hydrateForm(snapshot);
        setActiveName(snapshot.configuration?.displayName ?? null);
        setIsLoading(false);
      })
      .catch((caught: unknown) => {
        if (!alive) {
          return;
        }
        if (caught instanceof ApiClientError && caught.status === 401) {
          router.replace("/admin/login");
          return;
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load mail service settings.",
        );
        setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [hydrateForm, router]);

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      const allowedDomains = parseDomains(form.allowedDomains);
      if (!form.selectedProvider) {
        setError("Select a mail provider.");
        return;
      }
      if (allowedDomains.length === 0) {
        setError("Add at least one allowed email domain.");
        return;
      }
      setError(null);
      setSuccess(null);
      setIsSaving(true);
      try {
        const snapshot = await adminMailServiceApi.save({
          allowedDomains,
          config: form.values,
          displayName: form.displayName.trim(),
          providerId: form.selectedProvider.id,
        });
        form.hydrate(snapshot);
        setActiveName(snapshot.configuration?.displayName ?? form.displayName);
        setSuccess("Mail service settings were saved.");
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to save mail service settings.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [form],
  );

  const fields = useMemo(
    () =>
      (form.selectedProvider?.fields ?? [])
        .filter(isServiceField)
        .map((field) => ({
          ...(field.autocomplete ? { autocomplete: field.autocomplete } : {}),
          ...(field.help ? { help: field.help } : {}),
          kind: field.kind,
          label: field.label,
          name: field.name,
          onChange: form.fieldInput(field.name),
          options: field.options ?? [],
          ...(field.placeholder ? { placeholder: field.placeholder } : {}),
          required: field.required,
          value: form.values[field.name] ?? "",
        })),
    [form],
  );
  const providers = useMemo(
    () =>
      form.providers.map((provider) => ({
        description: provider.description,
        id: provider.id,
        isSelected: provider.id === form.selectedId,
        name: provider.name,
        onSelect: () => form.selectProvider(provider.id),
      })),
    [form],
  );

  return {
    allowedDomains: form.allowedDomains,
    allowedDomainsInput: form.allowedDomainsInput,
    displayName: form.displayName,
    displayNameInput: form.displayNameInput,
    error,
    fields,
    isLoading,
    isSaving,
    onSubmit,
    providers,
    saveLabel: isSaving ? "Saving settings…" : "Save settings",
    status: activeName
      ? {
          description: `${activeName} is the active organization mail service.`,
          label: "Service configured",
          tone: "success",
        }
      : {
          description:
            "Choose a provider and save its service connection before members sign in.",
          label: "Setup required",
          tone: "neutral",
        },
    success,
  };
};
