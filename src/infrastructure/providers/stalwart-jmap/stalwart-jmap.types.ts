export const JMAP_CORE = "urn:ietf:params:jmap:core";
export const JMAP_MAIL = "urn:ietf:params:jmap:mail";
export const JMAP_SUBMISSION = "urn:ietf:params:jmap:submission";
export const STALWART_JMAP = "urn:stalwart:jmap";
export const MAX_JMAP_BODY_VALUE_BYTES = 256_000;
export const MAX_JMAP_BODY_VALUE_CHARACTERS = 256_000;
export const MAX_JMAP_BODY_VALUE_PARTS = 128;
export const MAX_JMAP_RENDERED_BODY_CHARACTERS = 256_000;
export const JMAP_BODY_TRUNCATION_TEXT =
  "[Message content truncated by Veda Mail.]";
export const JMAP_RECEIVED_ATTACHMENT_BODY_PROPERTIES = [
  "partId",
  "blobId",
  "size",
  "name",
  "type",
  "disposition",
  "cid",
] as const;

export interface StalwartConfig {
  readonly authType: "basic" | "bearer";
  readonly baseUrl: string;
  readonly expiresAt?: string;
  readonly oauthClientId?: string;
  readonly refreshToken?: string;
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
  readonly myRights?: {
    readonly mayCreateChild: boolean;
      readonly mayDelete: boolean;
      readonly mayRename: boolean;
      readonly maySetKeywords?: boolean | undefined;
  } | undefined;
  readonly name: string;
  readonly parentId?: string | null | undefined;
  readonly role?: string | null | undefined;
  readonly sortOrder?: number | undefined;
  readonly totalEmails: number;
  readonly unreadEmails: number;
}

export interface JmapAddress {
  readonly email: string;
  readonly name?: string | null | undefined;
}

export interface JmapBodyPart {
  readonly blobId?: string | null | undefined;
  readonly cid?: string | null | undefined;
  readonly disposition?: string | null | undefined;
  readonly name?: string | null | undefined;
  readonly partId?: string | null | undefined;
  readonly size?: number | null | undefined;
  readonly type: string;
}

export interface JmapEmail {
  readonly attachments?: readonly JmapBodyPart[] | undefined;
  readonly bcc?: readonly JmapAddress[] | null | undefined;
  readonly bodyValues?:
    | Readonly<
        Record<
          string,
          {
            readonly isTruncated?: boolean | undefined;
            readonly value: string;
          }
        >
      >
    | undefined;
  readonly bodyValuesTruncated?: boolean | undefined;
  readonly cc?: readonly JmapAddress[] | null | undefined;
  readonly from?: readonly JmapAddress[] | null | undefined;
  readonly hasAttachment: boolean;
  readonly htmlBody?: readonly JmapBodyPart[] | undefined;
  readonly id: string;
  readonly keywords: Readonly<Record<string, boolean>>;
  readonly mailboxIds: Readonly<Record<string, boolean>>;
  readonly messageId?: readonly string[] | null | undefined;
  readonly preview: string;
  readonly receivedAt: string;
  readonly references?: readonly string[] | null | undefined;
  readonly replyTo?: readonly JmapAddress[] | null | undefined;
  readonly size: number;
  readonly subject: string | null;
  readonly textBody?: readonly JmapBodyPart[] | undefined;
  readonly threadId: string;
  readonly to?: readonly JmapAddress[] | null | undefined;
}
