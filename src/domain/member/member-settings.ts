export interface MemberProfile {
  readonly displayName: string;
  readonly email: string;
}

export interface MemberProfileUpdate {
  readonly displayName: string;
}

export interface MemberPasswordChange {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly otpCode?: string;
}

export interface MemberTwoFactorUpdate {
  readonly currentPassword: string;
  readonly otpCode: string;
  readonly otpUrl: string | null;
}

export interface MemberTwoFactorEnrollment {
  readonly qrDataUrl: string;
  readonly secret: string;
}
