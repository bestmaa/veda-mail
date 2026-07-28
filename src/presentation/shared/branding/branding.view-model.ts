import type { CSSProperties } from "react";

import { accessibleForeground } from "@/domain/shared/color-contrast";

export interface BrandingViewModel {
  readonly accentColor: string;
  readonly brandStyle: CSSProperties;
  readonly logoUrl: string | null;
  readonly organizationName: string;
  readonly primaryColor: string;
  readonly productName: string;
  readonly publicRepositoryUrl: string | null;
}

export interface BrandingInput {
  readonly accentColor?: string;
  readonly logoUrl?: string | null;
  readonly organizationName?: string;
  readonly primaryColor?: string;
  readonly productName?: string;
  readonly publicRepositoryUrl?: string | null;
}

export const createBrandingViewModel = (
  input: BrandingInput = {},
): BrandingViewModel => {
  const primaryColor = input.primaryColor ?? "#2f3274";
  const accentColor = input.accentColor ?? "#ff785a";
  return {
    accentColor,
    brandStyle: {
      "--brand-accent": accentColor,
      "--brand-accent-foreground": accessibleForeground(accentColor),
      "--brand-primary": primaryColor,
    } as CSSProperties,
    logoUrl: input.logoUrl ?? null,
    organizationName: input.organizationName ?? "Your organization",
    primaryColor,
    productName: input.productName ?? "Veda Mail",
    publicRepositoryUrl: input.publicRepositoryUrl ?? null,
  };
};
