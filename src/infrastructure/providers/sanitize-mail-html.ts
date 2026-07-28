import "server-only";

import {
  compile,
  type HtmlToTextOptions,
  type SelectorDefinition,
} from "html-to-text";
import sanitizeHtml from "sanitize-html";

const MAX_MAIL_HTML_CHILD_NODES = 1_000;
const MAX_MAIL_HTML_DEPTH = 32;
const MAX_MAIL_HTML_TO_TEXT_CHARACTERS = 256_000;

const allowedTags = [
  "a",
  "address",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
] as const;

const safeLinkHref = (value?: string): string | null => {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? candidate
      : null;
  } catch {
    return null;
  }
};

const singleLineBlock = {
  leadingLineBreaks: 1,
  trailingLineBreaks: 1,
} as const;

const blockSelectors = [
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "footer",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
].map(
  (selector): SelectorDefinition => ({
    format: "block",
    options: singleLineBlock,
    selector,
  }),
);

const headingSelectors = ["h1", "h2", "h3", "h4", "h5", "h6"].map(
  (selector): SelectorDefinition => ({
    format: "heading",
    options: { ...singleLineBlock, uppercase: false },
    selector,
  }),
);

const mailHtmlToTextOptions: HtmlToTextOptions = {
  decodeEntities: true,
  limits: {
    ellipsis: "…",
    maxChildNodes: MAX_MAIL_HTML_CHILD_NODES,
    maxDepth: MAX_MAIL_HTML_DEPTH,
    maxInputLength: MAX_MAIL_HTML_TO_TEXT_CHARACTERS,
  },
  preserveNewlines: false,
  selectors: [
    ...blockSelectors,
    ...headingSelectors,
    {
      selector: "a",
      options: { ignoreHref: true },
    },
    {
      format: "paragraph",
      options: singleLineBlock,
      selector: "p",
    },
    {
      format: "pre",
      options: singleLineBlock,
      selector: "pre",
    },
    {
      format: "lineBreak",
      selector: "hr",
    },
    ...["head", "iframe", "script", "style", "template", "title"].map(
      (selector): SelectorDefinition => ({
        format: "skip",
        selector,
      }),
    ),
  ],
  whitespaceCharacters: " \t\r\n\f\u00a0\u200b",
  wordwrap: false,
};

const convertMailHtmlToPlainText = compile(mailHtmlToTextOptions);

export const sanitizeMailHtml = (value: string): string =>
  sanitizeHtml(value, {
    allowProtocolRelative: false,
    allowedAttributes: {
      a: ["href", "rel", "target", "title"],
      blockquote: ["cite"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedTags: [...allowedTags],
    disallowedTagsMode: "discard",
    nestingLimit: MAX_MAIL_HTML_DEPTH,
    nonTextTags: [
      "head",
      "iframe",
      "option",
      "script",
      "style",
      "template",
      "textarea",
      "title",
    ],
    transformTags: {
      a: (tagName, attributes) => {
        const href = safeLinkHref(attributes["href"]);
        return {
          attribs: href
            ? {
                href,
                rel: "noopener noreferrer",
                target: "_blank",
                ...(attributes["title"]
                  ? { title: attributes["title"] }
                  : {}),
              }
            : attributes["title"]
              ? { title: attributes["title"] }
              : {},
          tagName,
        };
      },
    },
  });

export const mailHtmlToPlainText = (value: string): string => {
  const boundedInput = value.slice(0, MAX_MAIL_HTML_TO_TEXT_CHARACTERS);
  const boundedSanitizedHtml = sanitizeMailHtml(boundedInput).slice(
    0,
    MAX_MAIL_HTML_TO_TEXT_CHARACTERS,
  );
  return convertMailHtmlToPlainText(boundedSanitizedHtml)
    .slice(0, MAX_MAIL_HTML_TO_TEXT_CHARACTERS)
    .trim();
};
