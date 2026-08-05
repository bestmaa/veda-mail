import type { MetadataRoute } from "next";
import { installationStore } from "@/server/installation/installation.store";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await installationStore.getBranding();
  return {
    background_color: "#080d2b",
    description: `Private, provider-independent webmail for ${branding.organizationName}.`,
    display: "standalone",
    icons: [
      { purpose: "any", sizes: "192x192", src: "/icons/veda-mail-192.png", type: "image/png" },
      { purpose: "any", sizes: "512x512", src: "/icons/veda-mail-512.png", type: "image/png" },
      { purpose: "maskable", sizes: "512x512", src: "/icons/veda-mail-512.png", type: "image/png" },
    ],
    id: "/",
    name: branding.productName,
    orientation: "any",
    scope: "/",
    short_name: branding.productName.slice(0, 24),
    start_url: "/",
    theme_color: branding.primaryColor,
  };
}
