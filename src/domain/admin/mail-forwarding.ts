export type MailForwardingStatus = "active" | "applying" | "error";

export interface MailForwardingConfiguration {
  readonly destinationEmail: string;
  readonly keepLocalCopy: true;
  readonly sourceAddresses: readonly string[];
  readonly sourceEmail: string;
  readonly status: MailForwardingStatus;
  readonly updatedAt: string;
}

export interface MailForwardingSnapshot {
  readonly availability: "available" | "conflict" | "unconfigured" | "unsupported";
  readonly configuration: MailForwardingConfiguration | null;
  readonly reason: string | null;
  readonly revision: number;
}
