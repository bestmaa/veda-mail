import "server-only";

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
import { ApiError } from "@/transport/http/api-error";

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

const invalidContent = (): ApiError =>
  new ApiError(
    "The message body contains invalid or unsupported content.",
    "INVALID_MESSAGE_CONTENT",
    422,
  );

const oversizedContent = (): ApiError =>
  new ApiError(
    "The message body exceeds the safe content limit.",
    "MESSAGE_CONTENT_TOO_LARGE",
    413,
  );

const complexContent = (): ApiError =>
  new ApiError(
    "The rich message body is too complex.",
    "MESSAGE_CONTENT_TOO_COMPLEX",
    422,
  );

const assertSafeText = (value: string): void => {
  if (!outgoingContentWithinLimit(value)) throw oversizedContent();
  if (
    hasUnpairedContentSurrogate(value) ||
    hasDisallowedContentControl(value)
  ) {
    throw invalidContent();
  }
};

const safeLinkHref = (value?: string): string | null => {
  const result = canonicalizeOutgoingLink(value);
  if (result.status === "too-large") throw oversizedContent();
  return result.status === "valid" ? result.href : null;
};

const singleLineBlock = {
  leadingLineBreaks: 1,
  trailingLineBreaks: 1,
} as const;

const headingSelectors = ["h1", "h2"].map(
  (selector): SelectorDefinition => ({
    format: "heading",
    options: { ...singleLineBlock, uppercase: false },
    selector,
  }),
);

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
      if (
        nodes > MAX_OUTGOING_HTML_NODES ||
        depth > MAX_OUTGOING_HTML_DEPTH
      ) {
        throw complexContent();
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

interface OutgoingMailContentInput {
  readonly body: string;
  readonly htmlBody?: string | undefined;
}

export const canonicalizeOutgoingMailContent = (
  input: OutgoingMailContentInput,
): CanonicalOutgoingMailContent => {
  assertSafeText(input.body);
  const clientBody = input.body.trim();
  if (!clientBody) throw invalidContent();
  if (input.htmlBody === undefined) return { body: clientBody };

  assertSafeText(input.htmlBody);
  if (!combinedOutgoingContentWithinLimit(clientBody, input.htmlBody)) {
    throw oversizedContent();
  }
  const htmlBody = sanitizeOutgoingHtml(input.htmlBody);
  const body = convertHtmlToText(htmlBody).trim();
  assertSafeText(body);
  if (!htmlBody || !body) throw invalidContent();
  if (!combinedOutgoingContentWithinLimit(body, htmlBody)) {
    throw oversizedContent();
  }
  return { body, htmlBody };
};
