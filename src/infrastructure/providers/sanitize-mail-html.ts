import "server-only";

import {
  compile,
  type HtmlToTextOptions,
  type SelectorDefinition,
} from "html-to-text";
import sanitizeHtml from "sanitize-html";

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
  "main",
  "nav",
  "section",
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
      format: "orderedList",
      options: singleLineBlock,
      selector: "ol",
    },
    {
      format: "unorderedList",
      options: { ...singleLineBlock, itemPrefix: "- " },
      selector: "ul",
    },
    {
      format: "dataTable",
      options: {
        ...singleLineBlock,
        uppercaseHeaderCells: false,
      },
      selector: "table",
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

export const mailHtmlToPlainText = (value: string): string =>
  convertMailHtmlToPlainText(sanitizeMailHtml(value)).trim();
