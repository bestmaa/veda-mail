import type { CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import { accessibleForeground } from "@/domain/shared/color-contrast";
import { installationStore } from "@/server/installation/installation.store";
import { PwaRegistration } from "@/presentation/shared/pwa/pwa-registration";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const dynamic = "force-dynamic";
export const viewport: Viewport = { themeColor: "#0b1238" };

export const generateMetadata = async (): Promise<Metadata> => {
  const branding = await installationStore.getBranding();
  const metadataBase = new URL(
    process.env["VEDA_MAIL_PUBLIC_URL"] || "http://localhost:3000",
  );
  return {
    appleWebApp: { capable: true, statusBarStyle: "black-translucent",
      title: branding.productName },
    description: `${branding.productName} is the private webmail workspace for ${branding.organizationName}.`,
    metadataBase,
    manifest: "/manifest.webmanifest",
    openGraph: {
      description: "White-label, provider-independent webmail for organizations.",
      images: ["/og.png"],
      title: branding.productName,
      type: "website",
    },
    robots: { follow: false, index: false },
    title: {
      default: branding.productName,
      template: `%s · ${branding.productName}`,
    },
    twitter: {
      card: "summary_large_image",
      images: ["/og.png"],
      title: branding.productName,
    },
  };
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const branding = await installationStore.getBranding();
  const brandStyle = {
    "--brand-accent": branding.accentColor,
    "--brand-accent-foreground": accessibleForeground(branding.accentColor),
    "--brand-primary": branding.primaryColor,
  } as CSSProperties;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} h-full antialiased`}
      style={brandStyle}
    >
      <body className="min-h-full">{children}<PwaRegistration /></body>
    </html>
  );
}
