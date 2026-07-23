import type { BrandingViewModel } from "@/presentation/shared/branding/branding.view-model";

export const BrandMarkView = ({
  branding,
  size = "md",
}: {
  readonly branding: BrandingViewModel;
  readonly size?: "md" | "sm";
}) => (
  <span
    className={`grid shrink-0 place-items-center overflow-hidden rounded-2xl shadow-lg ${
      size === "sm" ? "size-10" : "size-12"
    }`}
    style={{ backgroundColor: branding.primaryColor }}
  >
    {branding.logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${branding.organizationName} logo`}
        className="size-full object-cover"
        src={branding.logoUrl}
      />
    ) : (
      <span
        className="size-5 rotate-45 rounded-md border-[3px]"
        style={{ borderColor: branding.accentColor }}
      />
    )}
  </span>
);
