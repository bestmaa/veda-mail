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
