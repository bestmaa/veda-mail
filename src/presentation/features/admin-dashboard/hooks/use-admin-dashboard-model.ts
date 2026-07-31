"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import type {
  AdminDashboardViewProps,
  AdminSection,
} from "@/presentation/features/admin-dashboard/admin-dashboard.view-model";
import {
  createBrandingViewModel,
  type BrandingInput,
} from "@/presentation/shared/branding/branding.view-model";

const labels: Readonly<Record<AdminSection, string>> = {
  mail: "Mail service",
  organization: "Organization",
  security: "Security",
  users: "Mailbox users",
};

export const useAdminDashboardModel = (
  brandingInput: BrandingInput,
): AdminDashboardViewProps & { readonly activeSection: AdminSection } => {
  const router = useRouter();
  const [activeSection, setActiveSection] =
    useState<AdminSection>("organization");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const onSignOut = useCallback(async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const response = await fetch("/api/v1/admin/auth", { method: "DELETE" });
    if (response.ok) {
      router.replace("/admin/login");
      router.refresh();
      return;
    }
    setIsSigningOut(false);
  }, [isSigningOut, router]);
  const navigation = useMemo(
    () =>
      (Object.keys(labels) as readonly AdminSection[]).map((id) => ({
        id,
        isActive: id === activeSection,
        label: labels[id],
        onSelect: () => setActiveSection(id),
      })),
    [activeSection],
  );
  return {
    activeSection,
    branding: createBrandingViewModel(brandingInput),
    isSigningOut,
    navigation,
    onSignOut,
  };
};
