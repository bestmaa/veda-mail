import {
  compile,
  type HtmlToTextOptions,
  type SelectorDefinition,
} from "html-to-text";
import sanitizeHtml from "sanitize-html";

import {
  canonicalizeOutgoingLink,
  combinedOutgoingContentWithinLimit,
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentWithinLimit,
} from "@/domain/mail/outgoing-content-policy";
import { MAX_OUTGOING_HTML_NODES } from "@/domain/mail/mail";

const MAX_OUTGOING_HTML_DEPTH = 32;
const allowedTags = [
  "a",
  "em",
  "h1",
  "h2",
  "li",
  "ol",
  "p",
  "br",
  "strong",
  "u",
  "ul",
] as const;

export type OutgoingMailContentFailure = "complex" | "invalid" | "oversized";

export class OutgoingMailContentPolicyError extends Error {
  public constructor(public readonly failure: OutgoingMailContentFailure) {
    super(failure);
    this.name = "OutgoingMailContentPolicyError";
  }
}

const failure = (value: OutgoingMailContentFailure) =>
  new OutgoingMailContentPolicyError(value);

const assertSafeText = (value: string): void => {
  if (!outgoingContentWithinLimit(value)) throw failure("oversized");
  if (
    hasUnpairedContentSurrogate(value) ||
    hasDisallowedContentControl(value)
  ) {
    throw failure("invalid");
  }
};

const safeLinkHref = (value?: string): string | null => {
  const result = canonicalizeOutgoingLink(value);
  if (result.status === "too-large") throw failure("oversized");
  return result.status === "valid" ? result.href : null;
};

const singleLineBlock = {
  leadingLineBreaks: 1,
  trailingLineBreaks: 1,
} as const;
const headingSelectors = ["h1", "h2"].map((selector): SelectorDefinition => ({
  format: "heading",
  options: { ...singleLineBlock, uppercase: false },
  selector,
}));
const textOptions: HtmlToTextOptions = {
  decodeEntities: true,
  preserveNewlines: false,
  selectors: [
    ...headingSelectors,
    {
      selector: "a",
      options: { hideLinkHrefIfSameAsText: true },
    },
    {
      format: "paragraph",
      options: singleLineBlock,
      selector: "p",
    },
  ],
  whitespaceCharacters: " \t\r\n\f\u00a0\u200b",
  wordwrap: false,
};
const convertHtmlToText = compile(textOptions);

const sanitizeOutgoingHtml = (value: string): string => {
  let depth = 0;
  let nodes = 0;
  const sanitized = sanitizeHtml(value, {
    allowProtocolRelative: false,
    allowedAttributes: { a: ["href", "rel", "target"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedTags: [...allowedTags],
    disallowedTagsMode: "discard",
    nestingLimit: MAX_OUTGOING_HTML_DEPTH,
    nonTextTags: [
      "embed",
      "form",
      "head",
      "iframe",
      "math",
      "noscript",
      "object",
      "option",
      "script",
      "style",
      "svg",
      "template",
      "textarea",
      "title",
    ],
    onCloseTag: () => {
      depth = Math.max(0, depth - 1);
    },
    onOpenTag: () => {
      nodes += 1;
      depth += 1;
      if (nodes > MAX_OUTGOING_HTML_NODES || depth > MAX_OUTGOING_HTML_DEPTH) {
        throw failure("complex");
      }
    },
    parseStyleAttributes: false,
    transformTags: {
      a: (tagName, attributes) => {
        const href = safeLinkHref(attributes["href"]);
        return {
          attribs: href
            ? {
                href,
                rel: "noopener noreferrer",
                target: "_blank",
              }
            : {},
          tagName,
        };
      },
      b: "strong",
      i: "em",
    },
  }).trim();
  assertSafeText(sanitized);
  return sanitized;
};

export interface CanonicalOutgoingMailContent {
  readonly body: string;
  readonly htmlBody?: string;
}

export interface OutgoingMailContentInput {
  readonly body: string;
  readonly htmlBody?: string | undefined;
}

const canonicalizeContent = (
  input: OutgoingMailContentInput,
  allowBlank: boolean,
): CanonicalOutgoingMailContent => {
  assertSafeText(input.body);
  const clientBody = input.body.trim();
  if (input.htmlBody === undefined) {
    if (!allowBlank && !clientBody) throw failure("invalid");
    return { body: clientBody };
  }
  assertSafeText(input.htmlBody);
  if (!combinedOutgoingContentWithinLimit(clientBody, input.htmlBody)) {
    throw failure("oversized");
  }
  const htmlBody = sanitizeOutgoingHtml(input.htmlBody);
  const body = convertHtmlToText(htmlBody).trim();
  assertSafeText(body);
  if (allowBlank && !htmlBody) return { body: "" };
  if (!allowBlank && (!htmlBody || !body)) throw failure("invalid");
  if (!combinedOutgoingContentWithinLimit(body, htmlBody)) {
    throw failure("oversized");
  }
  return { body, htmlBody };
};

export const canonicalizeOutgoingMailContentValue = (
  input: OutgoingMailContentInput,
): CanonicalOutgoingMailContent => canonicalizeContent(input, false);

export const canonicalizeDraftMailContentValue = (
  input: OutgoingMailContentInput,
): CanonicalOutgoingMailContent => canonicalizeContent(input, true);

export const hasCanonicalDraftMailContent = (
  input: OutgoingMailContentInput,
): boolean => {
  try {
    const canonical = canonicalizeDraftMailContentValue(input);
    return (
      canonical.body === input.body && canonical.htmlBody === input.htmlBody
    );
  } catch {
    return false;
  }
};
