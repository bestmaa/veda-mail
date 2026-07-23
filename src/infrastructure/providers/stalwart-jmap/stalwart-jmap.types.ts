export const JMAP_CORE = "urn:ietf:params:jmap:core";
export const JMAP_MAIL = "urn:ietf:params:jmap:mail";
export const JMAP_SUBMISSION = "urn:ietf:params:jmap:submission";

export interface StalwartConfig {
  readonly authType: "basic" | "bearer";
  readonly baseUrl: string;
  readonly secret: string;
  readonly username: string;
}

export interface JmapSession {
  readonly accounts: Readonly<
    Record<string, { readonly name: string; readonly isReadOnly: boolean }>
  >;
  readonly apiUrl: string;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly downloadUrl: string;
  readonly primaryAccounts: Readonly<Record<string, string>>;
  readonly uploadUrl: string;
  readonly username: string;
}

export type JmapMethodCall = readonly [
  method: string,
  arguments: Readonly<Record<string, unknown>>,
  callId: string,
];

export type JmapMethodResponse = readonly [
  method: string,
  payload: unknown,
  callId: string,
];

export interface JmapResponse {
  readonly methodResponses: readonly JmapMethodResponse[];
  readonly sessionState: string;
}

export interface JmapMailbox {
  readonly id: string;
  readonly name: string;
  readonly role?: string | null | undefined;
  readonly totalEmails: number;
  readonly unreadEmails: number;
}

export interface JmapAddress {
  readonly email: string;
  readonly name?: string | null | undefined;
}

export interface JmapBodyPart {
  readonly blobId?: string | undefined;
  readonly name?: string | null | undefined;
  readonly partId?: string | undefined;
  readonly size?: number | undefined;
  readonly type: string;
}

export interface JmapEmail {
  readonly attachments?: readonly JmapBodyPart[] | undefined;
  readonly bcc?: readonly JmapAddress[] | null | undefined;
  readonly bodyValues?:
    | Readonly<Record<string, { readonly value: string }>>
    | undefined;
  readonly cc?: readonly JmapAddress[] | null | undefined;
  readonly from?: readonly JmapAddress[] | null | undefined;
  readonly hasAttachment: boolean;
  readonly htmlBody?: readonly JmapBodyPart[] | undefined;
  readonly id: string;
  readonly keywords: Readonly<Record<string, boolean>>;
  readonly mailboxIds: Readonly<Record<string, boolean>>;
  readonly preview: string;
  readonly receivedAt: string;
  readonly size: number;
  readonly subject: string | null;
  readonly textBody?: readonly JmapBodyPart[] | undefined;
  readonly threadId: string;
  readonly to?: readonly JmapAddress[] | null | undefined;
}
