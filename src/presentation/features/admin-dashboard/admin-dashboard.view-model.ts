import type { BrandingViewModel } from "@/presentation/shared/branding/branding.view-model";
import type { ReactNode } from "react";

export type AdminSection =
  | "capabilities"
  | "mail"
  | "organization"
  | "security"
  | "users";
export type AdminDashboardContent = ReactNode;

export interface AdminNavigationItem {
  readonly id: AdminSection;
  readonly isActive: boolean;
  readonly label: string;
  readonly onSelect: () => void;
}

export interface AdminDashboardViewProps {
  readonly branding: BrandingViewModel;
  readonly isSigningOut: boolean;
  readonly navigation: readonly AdminNavigationItem[];
  readonly onSignOut: () => void;
}
