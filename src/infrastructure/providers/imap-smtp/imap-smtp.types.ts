export type TransportSecurity = "starttls" | "tls";

export interface ImapSmtpServiceConfig
  extends Readonly<Record<string, string>> {
  readonly imapHost: string;
  readonly imapPort: string;
  readonly imapSecurity: TransportSecurity;
  readonly smtpHost: string;
  readonly smtpPort: string;
  readonly smtpSecurity: TransportSecurity;
}

export interface ImapSmtpMemberConfig extends ImapSmtpServiceConfig {
  readonly secret: string;
  readonly username: string;
}

export interface ImapMessageReference {
  readonly mailbox: string;
  readonly uid: number;
}
