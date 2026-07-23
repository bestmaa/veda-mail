"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEventHandler,
  type CSSProperties,
  type FormEventHandler,
} from "react";

import type { AdminOrganizationViewProps } from "@/presentation/features/admin-organization/admin-organization.view-model";

interface OrganizationSnapshot {
  readonly accentColor: string;
  readonly logoUrl: string | null;
  readonly organizationName: string;
  readonly primaryColor: string;
  readonly productName: string;
  readonly publicRepositoryUrl: string | null;
}
const parse = async (response: Response): Promise<OrganizationSnapshot> => {
  const payload = (await response.json()) as {
    readonly data?: OrganizationSnapshot;
    readonly error?: { readonly message?: string };
  };
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to save organization settings.");
  }
  return payload.data;
};

export const useAdminOrganizationModel = (): AdminOrganizationViewProps => {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("");
  const [productName, setProductName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#2f3274");
  const [accentColor, setAccentColor] = useState("#ff785a");
  const [publicRepositoryUrl, setPublicRepositoryUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const hydrate = useCallback((snapshot: OrganizationSnapshot) => {
    setOrganizationName(snapshot.organizationName);
    setProductName(snapshot.productName);
    setPrimaryColor(snapshot.primaryColor);
    setAccentColor(snapshot.accentColor);
    setPublicRepositoryUrl(snapshot.publicRepositoryUrl ?? "");
    setLogoUrl(snapshot.logoUrl);
    setLogo(null);
    setRemoveLogo(false);
  }, []);
  useEffect(() => {
    let alive = true;
    void fetch("/api/v1/admin/organization")
      .then(parse)
      .then((snapshot) => {
        if (!alive) return;
        hydrate(snapshot);
        setIsLoading(false);
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setError(caught instanceof Error ? caught.message : "Unable to load organization.");
        setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [hydrate]);
  const input = useCallback(
    (setter: (value: string) => void): ChangeEventHandler<HTMLInputElement> =>
      (event) => setter(event.target.value),
    [],
  );
  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      setError(null);
      setSuccess(null);
      setIsSaving(true);
      const body = new FormData();
      body.set("organizationName", organizationName.trim());
      body.set("productName", productName.trim());
      body.set("primaryColor", primaryColor);
      body.set("accentColor", accentColor);
      body.set("publicRepositoryUrl", publicRepositoryUrl.trim());
      if (logo) body.set("logo", logo);
      if (removeLogo) body.set("removeLogo", "true");
      try {
        hydrate(await parse(await fetch("/api/v1/admin/organization", { body, method: "PUT" })));
        setSuccess("Organization identity saved.");
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to save organization.");
      } finally {
        setIsSaving(false);
      }
    },
    [accentColor, hydrate, logo, organizationName, primaryColor, productName, publicRepositoryUrl, removeLogo, router],
  );
  return {
    accentColor,
    accentColorInput: input(setAccentColor),
    error,
    isLoading,
    isSaving,
    logoFileName: logo?.name ?? null,
    logoInput: (event) => {
      setLogo(event.target.files?.[0] ?? null);
      setRemoveLogo(false);
    },
    logoUrl,
    onRemoveLogo: () => {
      setLogo(null);
      setLogoUrl(null);
      setRemoveLogo(true);
    },
    onSubmit,
    organizationName,
    organizationNameInput: input(setOrganizationName),
    primaryColor,
    primaryColorInput: input(setPrimaryColor),
    productName,
    productNameInput: input(setProductName),
    publicRepositoryUrl,
    publicRepositoryUrlInput: input(setPublicRepositoryUrl),
    removeLogo,
    style: { "--brand-accent": accentColor, "--brand-primary": primaryColor } as CSSProperties,
    success,
  };
};
