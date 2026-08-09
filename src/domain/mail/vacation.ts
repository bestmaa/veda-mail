export const JMAP_VACATION_RESPONSE =
  "urn:ietf:params:jmap:vacationresponse";
export const MAX_VACATION_SUBJECT_CHARACTERS = 998;
export const MAX_VACATION_BODY_CHARACTERS = 32_000;
export const MAX_VACATION_REQUEST_BYTES = 80 * 1024;

export const isCanonicalVacationUtcDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)) return false;
  try {
    return new Date(value).toISOString().replace(/\.\d{3}Z$/u, "Z") === value;
  } catch {
    return false;
  }
};

export type VacationCapability =
  | { readonly supported: true }
  | { readonly reason: string; readonly supported: false };

export interface VacationResponse {
  readonly fromDate: string | null;
  readonly htmlBody: string | null;
  readonly isEnabled: boolean;
  readonly revision: string;
  readonly subject: string | null;
  readonly textBody: string | null;
  readonly toDate: string | null;
}

export interface VacationResponseUpdate {
  readonly expectedRevision: string;
  readonly fromDate: string | null;
  readonly htmlBody: string | null;
  readonly isEnabled: boolean;
  readonly subject: string | null;
  readonly textBody: string | null;
  readonly toDate: string | null;
}

export interface VacationWorkspace {
  readonly capability: VacationCapability;
  readonly delegation: VacationCapability;
  readonly response: VacationResponse | null;
}
