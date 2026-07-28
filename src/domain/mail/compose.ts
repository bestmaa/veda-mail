import type {
  ComposeInput,
  MailAddress,
  MessageDetail,
} from "@/domain/mail/mail";

export interface RecipientBuckets {
  readonly bcc: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly to: readonly MailAddress[];
}

export interface RecipientInputs {
  readonly bcc: string;
  readonly cc: string;
  readonly to: string;
}

const addressKey = (address: MailAddress): string =>
  address.email.trim().toLowerCase();

const splitAddressInput = (value: string): readonly string[] => {
  const tokens: string[] = [];
  let current = "";
  let escaped = false;
  let inQuotes = false;
  let angleDepth = 0;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && inQuotes) {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      current += character;
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && character === "<") {
      angleDepth += 1;
    } else if (!inQuotes && character === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
    }
    if (!inQuotes && angleDepth === 0 && /[,;]/.test(character)) {
      tokens.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  tokens.push(current);
  return tokens;
};

const unquoteName = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const unquoted = trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    return unquoted || null;
  }
  return trimmed;
};

const parseAddressToken = (value: string): MailAddress | null => {
  const token = value.trim();
  if (!token) return null;
  const match = /^(.*?)<\s*([^<>]+)\s*>$/.exec(token);
  const email = (match?.[2] ?? token).trim();
  if (!email) return null;
  return {
    email,
    name: match ? unquoteName(match[1] ?? "") : null,
  };
};

export const parseAddressInput = (value: string): readonly MailAddress[] =>
  splitAddressInput(value)
    .map(parseAddressToken)
    .filter((address): address is MailAddress => address !== null);

const formatAddress = (address: MailAddress): string => {
  if (!address.name) return address.email;
  const escapedName = address.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escapedName}" <${address.email}>`;
};

export const formatAddressInput = (
  addresses: readonly MailAddress[],
): string => addresses.map(formatAddress).join(", ");

const takeUniqueAddresses = (
  addresses: readonly MailAddress[],
  seen: Set<string>,
): readonly MailAddress[] => {
  const unique: MailAddress[] = [];
  for (const address of addresses) {
    const key = addressKey(address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(address);
  }
  return unique;
};

export const normalizeRecipientBuckets = (
  buckets: RecipientBuckets,
  excludedEmails: readonly string[] = [],
): RecipientBuckets => {
  const seen = new Set(excludedEmails.map((email) => email.trim().toLowerCase()));
  const to = takeUniqueAddresses(buckets.to, seen);
  const cc = takeUniqueAddresses(buckets.cc, seen);
  const bcc = takeUniqueAddresses(buckets.bcc, seen);
  return { bcc, cc, to };
};

export const parseRecipientInputs = (
  inputs: RecipientInputs,
): RecipientBuckets =>
  normalizeRecipientBuckets({
    bcc: parseAddressInput(inputs.bcc),
    cc: parseAddressInput(inputs.cc),
    to: parseAddressInput(inputs.to),
  });

const prefixSubject = (subject: string, prefix: "Fwd" | "Re"): string => {
  const trimmed = subject.trim();
  const alreadyPrefixed =
    prefix === "Re" ? /^re\s*:/i.test(trimmed) : /^fwd?\s*:/i.test(trimmed);
  if (alreadyPrefixed) return trimmed;
  return trimmed ? `${prefix}: ${trimmed}` : `${prefix}:`;
};

const quoteText = (value: string): string =>
  value.split(/\r?\n/).map((line) => `> ${line}`).join("\n");

const unknownSender = "Unknown sender";

const replyBody = (message: MessageDetail): string => {
  const sender = message.from[0]
    ? formatAddress(message.from[0])
    : unknownSender;
  return `\n\nOn ${message.receivedAt}, ${sender} wrote:\n${quoteText(message.textBody)}`;
};

const replyRecipients = (message: MessageDetail): readonly MailAddress[] =>
  message.replyTo.length > 0 ? message.replyTo : message.from;

export const createReplyDraft = (message: MessageDetail): ComposeInput => ({
  bcc: [],
  body: replyBody(message),
  cc: [],
  inReplyTo: message.id,
  subject: prefixSubject(message.subject, "Re"),
  to: normalizeRecipientBuckets({
    bcc: [],
    cc: [],
    to: replyRecipients(message),
  }).to,
});

export const createReplyAllDraft = (
  message: MessageDetail,
  signedInEmail: string,
): ComposeInput => {
  const recipients = normalizeRecipientBuckets(
    {
      bcc: [],
      cc: message.cc,
      to: [...replyRecipients(message), ...message.to],
    },
    [signedInEmail],
  );
  return {
    ...recipients,
    body: replyBody(message),
    inReplyTo: message.id,
    subject: prefixSubject(message.subject, "Re"),
  };
};

const forwardedBody = (message: MessageDetail): string => {
  const from = formatAddressInput(message.from) || unknownSender;
  const to = formatAddressInput(message.to) || "Undisclosed recipients";
  const cc = formatAddressInput(message.cc);
  const headers = [
    "---------- Forwarded message ----------",
    `From: ${from}`,
    `Date: ${message.receivedAt}`,
    `Subject: ${message.subject}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
  ];
  return `\n\n${headers.join("\n")}\n\n${message.textBody}`;
};

export const createForwardDraft = (message: MessageDetail): ComposeInput => ({
  bcc: [],
  body: forwardedBody(message),
  cc: [],
  subject: prefixSubject(message.subject, "Fwd"),
  to: [],
});
