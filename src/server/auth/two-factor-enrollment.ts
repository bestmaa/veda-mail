import "server-only";

import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

import type { MemberTwoFactorEnrollment } from "@/domain/member/member-settings";
import type { ConnectionId } from "@/domain/shared/brand";

const ENROLLMENT_TTL_MS = 10 * 60 * 1_000;

interface PendingEnrollment {
  readonly createdAt: number;
  readonly otpUrl: string;
  readonly totp: OTPAuth.TOTP;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailTwoFactorEnrollments?: Map<ConnectionId, PendingEnrollment>;
};

const enrollments =
  globalState.__vedaMailTwoFactorEnrollments ??
  new Map<ConnectionId, PendingEnrollment>();

globalState.__vedaMailTwoFactorEnrollments = enrollments;

const prune = (): void => {
  const expiresBefore = Date.now() - ENROLLMENT_TTL_MS;
  for (const [connectionId, enrollment] of enrollments) {
    if (enrollment.createdAt < expiresBefore) {
      enrollments.delete(connectionId);
    }
  }
};

export const twoFactorEnrollmentStore = {
  async create(
    connectionId: ConnectionId,
    email: string,
    issuer: string,
  ): Promise<MemberTwoFactorEnrollment> {
    prune();
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      issuer,
      label: email,
      period: 30,
      secret: new OTPAuth.Secret({ size: 20 }),
    });
    const otpUrl = totp.toString();
    enrollments.set(connectionId, {
      createdAt: Date.now(),
      otpUrl,
      totp,
    });
    return {
      qrDataUrl: await QRCode.toDataURL(otpUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 240,
      }),
      secret: totp.secret.base32.replace(/(.{4})/g, "$1 ").trim(),
    };
  },

  verify(
    connectionId: ConnectionId,
    otpCode: string,
  ): { readonly otpUrl: string } | null {
    prune();
    const enrollment = enrollments.get(connectionId);
    if (!enrollment) {
      return null;
    }
    const delta = enrollment.totp.validate({
      token: otpCode,
      window: 1,
    });
    if (delta === null) {
      return null;
    }
    return { otpUrl: enrollment.otpUrl };
  },

  remove(connectionId: ConnectionId): void {
    enrollments.delete(connectionId);
  },
};
