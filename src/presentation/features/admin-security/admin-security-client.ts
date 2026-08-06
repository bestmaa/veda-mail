export interface SecuritySnapshot {
  readonly recoveryCodesRemaining: number;
  readonly recoveryConfigured: boolean;
  readonly twoFactorEnabled: boolean;
}

export interface AccountSnapshot {
  readonly security: SecuritySnapshot;
  readonly username: string;
}

export const adminSecurityData = async <T,>(response: Response): Promise<T> => {
  const payload = (await response.json()) as {
    readonly data?: T;
    readonly error?: { readonly message?: string };
  };
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }
  return payload.data;
};
