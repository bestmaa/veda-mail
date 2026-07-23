import { NextResponse } from "next/server";

import { readBrandLogo } from "@/server/branding/logo-store";
import { installationStore } from "@/server/installation/installation.store";

export const runtime = "nodejs";

export const GET = async () => {
  const installation = await installationStore.get();
  if (!installation?.organization.logoFileName) {
    return new NextResponse(null, { status: 404 });
  }
  const logo = await readBrandLogo(installation.organization.logoFileName);
  if (!logo) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(new Uint8Array(logo), {
    headers: {
      "Cache-Control": "public, max-age=300, must-revalidate",
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
