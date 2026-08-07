import "server-only";

import { createHmac } from "node:crypto";

import { securityAuditSubkey } from "@/server/security-audit/security-audit-key";

export const memberSessionOwnerKey = (email: string): string =>
  createHmac("sha256", securityAuditSubkey("member-session-owner"))
    .update(email.trim().toLowerCase(), "utf8")
    .digest("base64url");

export const memberSessionClientLabel = (request: Request): string => {
  const agent = request.headers.get("user-agent") ?? "";
  const browser = agent.includes("Edg/")
    ? "Edge"
    : agent.includes("Firefox/")
      ? "Firefox"
      : agent.includes("Chrome/")
        ? "Chrome"
        : agent.includes("Safari/")
          ? "Safari"
          : "Browser";
  const platform = /Android/iu.test(agent)
    ? "Android"
    : /iPhone|iPad/iu.test(agent)
      ? "iOS"
      : /Windows/iu.test(agent)
        ? "Windows"
        : /Macintosh|Mac OS/iu.test(agent)
          ? "macOS"
          : /Linux/iu.test(agent)
            ? "Linux"
            : "unknown device";
  return `${browser} on ${platform}`;
};
