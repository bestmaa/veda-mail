"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEventHandler,
} from "react";

import { useSetupFormModel } from "@/presentation/features/setup/hooks/use-setup-form-model";
import { useSetupNavigationModel } from "@/presentation/features/setup/hooks/use-setup-navigation-model";
import { setupWizardApi } from "@/presentation/features/setup/setup-wizard.api";
import {
  createSetupFieldViewModels,
  createSetupProviderViewModels,
} from "@/presentation/features/setup/setup-wizard.mapper";
import { validateSetupStep } from "@/presentation/features/setup/setup-wizard.validation";
import type { SetupWizardViewProps } from "@/presentation/features/setup/setup-wizard.view-model";
import type { ProviderManifest } from "@/domain/provider/provider";

export const useSetupWizardModel = (): SetupWizardViewProps => {
  const router = useRouter();
  const form = useSetupFormModel();
  const navigation = useSetupNavigationModel();
  const {
    allowedDomainsInput,
    data,
    input,
    logoInput,
    providerFieldInput,
    selectProvider,
  } = form;
  const { back, canGoBack, next, step, steps } = navigation;
  const [providers, setProviders] = useState<readonly ProviderManifest[]>([]);
  const [setupTokenConfigured, setSetupTokenConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let alive = true;
    void setupWizardApi
      .load()
      .then((snapshot) => {
        if (!alive) return;
        if (!snapshot.installationRequired) {
          router.replace("/admin");
          return;
        }
        setProviders(snapshot.providers);
        setSetupTokenConfigured(snapshot.setupTokenConfigured);
        selectProvider(snapshot.providers[0]);
        setIsLoading(false);
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setError(
          caught instanceof Error ? caught.message : "Unable to load setup.",
        );
        setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [router, selectProvider]);

  const selectedProvider = useMemo(
    () =>
      providers.find((provider) => provider.id === data.providerId),
    [data.providerId, providers],
  );
  const onNext = useCallback(() => {
    const failure = validateSetupStep(step, data, setupTokenConfigured);
    setError(failure);
    if (!failure) {
      next();
    }
  }, [data, next, setupTokenConfigured, step]);
  const onBack = useCallback(() => {
    setError(null);
    back();
  }, [back]);
  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      setError(null);
      setIsSubmitting(true);
      try {
        await setupWizardApi.complete(data);
        setSuccess(true);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to finish setup.",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [data],
  );

  return {
    accentColor: data.accentColor,
    accentColorInput: input("accentColor"),
    adminPassword: data.adminPassword,
    adminPasswordConfirmation: data.adminPasswordConfirmation,
    adminPasswordConfirmationInput: input("adminPasswordConfirmation"),
    adminPasswordInput: input("adminPassword"),
    adminUsername: data.adminUsername,
    adminUsernameInput: input("adminUsername"),
    allowedDomains: data.allowedDomains,
    allowedDomainsInput,
    canGoBack,
    error,
    fields: createSetupFieldViewModels(
      selectedProvider,
      data.providerConfig,
      providerFieldInput,
    ),
    isLoading,
    isSubmitting,
    logoFileName: data.logo?.name ?? null,
    logoInput,
    onBack,
    onNext,
    onSubmit,
    organizationName: data.organizationName,
    organizationNameInput: input("organizationName"),
    primaryColor: data.primaryColor,
    primaryColorInput: input("primaryColor"),
    productName: data.productName,
    productNameInput: input("productName"),
    providerDisplayName: data.providerDisplayName,
    providerDisplayNameInput: input("providerDisplayName"),
    providers: createSetupProviderViewModels(
      providers,
      data.providerId,
      selectProvider,
    ),
    publicRepositoryUrl: data.publicRepositoryUrl,
    publicRepositoryUrlInput: input("publicRepositoryUrl"),
    setupToken: data.setupToken,
    setupTokenConfigured,
    setupTokenInput: input("setupToken"),
    step,
    steps,
    style: {
      "--brand-accent": data.accentColor,
      "--brand-primary": data.primaryColor,
    } as CSSProperties,
    success,
  };
};
