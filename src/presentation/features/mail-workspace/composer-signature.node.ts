"use client";

import {
  $applyNodeReplacement,
  ElementNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from "lexical";

export const COMPOSER_SIGNATURE_ATTRIBUTE = "data-veda-signature-id";
const MAX_SIGNATURE_ID_CHARACTERS = 128;

export type SerializedEmailSignatureNode = Spread<
  {
    readonly signatureId: string | null;
    readonly type: "email-signature";
    readonly version: 1;
  },
  SerializedElementNode
>;

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)) return true;
  }
  return false;
};

const validSignatureId = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_SIGNATURE_ID_CHARACTERS &&
  value.trim() === value &&
  !hasControlCharacter(value);

const assertSignatureId = (value: string): string => {
  if (!validSignatureId(value)) {
    throw new RangeError("The email signature identifier is invalid.");
  }
  return value;
};

const checkedSignatureId = (value: string | null): string | null =>
  value === null ? null : assertSignatureId(value);

const convertSignatureElement = (
  element: HTMLElement,
): { node: EmailSignatureNode } | null => {
  const signatureId = element.getAttribute(COMPOSER_SIGNATURE_ATTRIBUTE);
  if (signatureId === null) return null;
  if (signatureId === "") return { node: $createEmailSignatureNode(null) };
  return validSignatureId(signatureId)
    ? { node: $createEmailSignatureNode(signatureId) }
    : null;
};

export class EmailSignatureNode extends ElementNode {
  __signatureId: string | null;

  public static override getType(): string {
    return "email-signature";
  }

  public static override clone(node: EmailSignatureNode): EmailSignatureNode {
    return new EmailSignatureNode(node.__signatureId, node.__key);
  }

  public static override importDOM(): DOMConversionMap {
    return {
      div: (element) =>
        element.hasAttribute(COMPOSER_SIGNATURE_ATTRIBUTE)
          ? {
              conversion: convertSignatureElement,
              priority: 2,
            }
          : null,
    };
  }

  public static override importJSON(
    serialized: SerializedEmailSignatureNode,
  ): EmailSignatureNode {
    return $createEmailSignatureNode(serialized.signatureId).updateFromJSON(
      serialized,
    );
  }

  public constructor(signatureId: string | null, key?: NodeKey) {
    super(key);
    this.__signatureId = checkedSignatureId(signatureId);
  }

  public override createDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "composer-signature-slot";
    element.setAttribute(
      COMPOSER_SIGNATURE_ATTRIBUTE,
      this.__signatureId ?? "",
    );
    return element;
  }

  public override updateDOM(
    previous: EmailSignatureNode,
    element: HTMLElement,
  ): boolean {
    if (previous.__signatureId !== this.__signatureId) {
      element.setAttribute(
        COMPOSER_SIGNATURE_ATTRIBUTE,
        this.__signatureId ?? "",
      );
    }
    return false;
  }

  public override exportDOM(editor: LexicalEditor): DOMExportOutput {
    const output = super.exportDOM(editor);
    if (output.element instanceof HTMLElement) {
      output.element.setAttribute(
        COMPOSER_SIGNATURE_ATTRIBUTE,
        this.getSignatureId() ?? "",
      );
    }
    return output;
  }

  public override exportJSON(): SerializedEmailSignatureNode {
    return {
      ...super.exportJSON(),
      signatureId: this.getSignatureId(),
      type: "email-signature",
      version: 1,
    };
  }

  public getSignatureId(): string | null {
    return this.getLatest().__signatureId;
  }

  public setSignatureId(signatureId: string | null): this {
    this.getWritable().__signatureId = checkedSignatureId(signatureId);
    return this;
  }

  public override updateFromJSON(
    serialized: LexicalUpdateJSON<SerializedEmailSignatureNode>,
  ): this {
    super.updateFromJSON(serialized);
    return this.setSignatureId(serialized.signatureId);
  }
}

export const $createEmailSignatureNode = (
  signatureId: string | null,
): EmailSignatureNode =>
  $applyNodeReplacement(new EmailSignatureNode(signatureId));

export const $isEmailSignatureNode = (
  node: LexicalNode | null | undefined,
): node is EmailSignatureNode => node instanceof EmailSignatureNode;
