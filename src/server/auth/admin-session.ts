import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import type { InstallationRecord } from "@/domain/installation/installation";
import { adminSessionStore } from "@/server/auth/admin-session-store";
import { installationStore } from "@/server/installation/installation.store";
import { verifyAdminPasswordDigest } from "@/server/installation/password-hash";
import { ApiError } from "@/transport/http/api-error";

export const ADMIN_COOKIE = "veda_mail_admin";
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

export const adminCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const;

const digest = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

const equal = (left: string, right: string): boolean =>
  timingSafeEqual(digest(left), digest(right));

const signature = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export const isAdminConfigured = async (): Promise<boolean> =>
  installationStore.isInstalled();

export const verifyAdminCredentials = async (
  username: string,
  password: string,
  installation?: InstallationRecord,
): Promise<boolean> => {
  const current = installation ?? (await installationStore.get());
  if (!current) {
    return false;
  }
  const passwordMatches = await verifyAdminPasswordDigest(
    password,
    current.owner.password,
  );
  return passwordMatches && equal(username, current.owner.username);
};

export const issueAdminToken = async (
  installation?: InstallationRecord,
): Promise<string> => {
  const current = installation ?? (await installationStore.get());
  if (!current) {
    throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
  }
  const expiresAtNumber =
    Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const expiresAt = String(expiresAtNumber);
  const nonce = randomBytes(18).toString("base64url");
  const payload = [
    current.owner.authVersion,
    expiresAt,
    nonce,
  ].join(".");
  await adminSessionStore.createAsync({
    authVersion: current.owner.authVersion,
    expiresAt: expiresAtNumber * 1_000,
    id: nonce,
  });
  return `${payload}.${signature(payload, current.sessionSecret)}`;
};

export const verifyAdminToken = async (
  token: string | undefined,
): Promise<boolean> => {
  const current = await installationStore.get();
  if (!token || !current) {
    return false;
  }
  const [authVersion, expiresAt, nonce, suppliedSignature] = token.split(".");
  if (
    !authVersion ||
    !expiresAt ||
    !nonce ||
    !suppliedSignature ||
    !/^\d+$/.test(authVersion) ||
    !/^\d+$/.test(expiresAt)
  ) {
    return false;
  }
  const expires = Number(expiresAt);
  const now = Math.floor(Date.now() / 1000);
  if (
    Number(authVersion) !== current.owner.authVersion ||
    expires <= now ||
    expires > now + ADMIN_SESSION_TTL_SECONDS
  ) {
    return false;
  }
  const payload = `${authVersion}.${expiresAt}.${nonce}`;
  const validSignature = equal(
    suppliedSignature,
    signature(payload, current.sessionSecret),
  );
  return validSignature && Boolean(
    await adminSessionStore.getAsync(nonce, current.owner.authVersion),
  );
};

export const revokeAdminToken = async (
  token: string | undefined,
): Promise<boolean> => {
  if (!(await verifyAdminToken(token))) return false;
  const nonce = token?.split(".")[2];
  return nonce ? adminSessionStore.removeAsync(nonce) : false;
};

export const getCurrentAdminSessionId = async (): Promise<string | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;
  if (!(await verifyAdminToken(token))) return null;
  return token?.split(".")[2] ?? null;
};

export const revokeCurrentAdminSession = async (): Promise<boolean> => {
  const cookieStore = await cookies();
  return revokeAdminToken(cookieStore.get(ADMIN_COOKIE)?.value);
};

export const hasAdminAccess = async (): Promise<boolean> => {
  const cookieStore = await cookies();
  return verifyAdminToken(cookieStore.get(ADMIN_COOKIE)?.value);
};

export const assertAdminAccess = async (): Promise<void> => {
  if (!(await hasAdminAccess())) {
    throw new ApiError(
      "Sign in as an administrator.",
      "ADMIN_UNAUTHORIZED",
      401,
    );
  }
};
