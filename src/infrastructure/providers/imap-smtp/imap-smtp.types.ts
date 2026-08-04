export type TransportSecurity = "starttls" | "tls";

export type ImapSmtpServiceConfig = Readonly<Record<string, string>> & {
  readonly imapHost: string;
  readonly imapPort: string;
  readonly imapSecurity: TransportSecurity;
  readonly manageSieveHost?: string;
  readonly manageSievePort?: string;
  readonly manageSieveSecurity?: TransportSecurity | "";
  readonly smtpHost: string;
  readonly smtpMaxMessageBytes: string;
  readonly smtpPort: string;
  readonly smtpSecurity: TransportSecurity;
};

export interface ImapSmtpMemberConfig extends ImapSmtpServiceConfig {
  readonly secret: string;
  readonly username: string;
}

export interface ImapMessageReference {
  readonly accountScope: string;
  readonly mailbox: string;
  readonly uid: number;
  readonly uidValidity: string;
  readonly version: 1;
}
