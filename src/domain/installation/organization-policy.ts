export interface OrganizationFeaturePolicy {
  readonly memberPasswordChange: boolean;
  readonly memberProfileEditing: boolean;
  readonly memberTwoFactorEnrollment: boolean;
}

export type OrganizationPolicyFeature = keyof OrganizationFeaturePolicy;

export const DEFAULT_ORGANIZATION_FEATURE_POLICY: OrganizationFeaturePolicy = {
  memberPasswordChange: true,
  memberProfileEditing: true,
  memberTwoFactorEnrollment: true,
};
