import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";

const observed = vi.hoisted(() => ({
  children: [] as { signatureId?: string | null; type: string }[],
}));

vi.mock(
  "@/presentation/features/mail-workspace/connectors/composer-signature-controls.connector",
  async () => {
    const lexical = await import("lexical");
    const lexicalReact = await import(
      "@lexical/react/LexicalComposerContext"
    );
    const signatureNodes = await import(
      "@/presentation/features/mail-workspace/composer-signature.node"
    );

    return {
      ComposerSignatureControlsConnector: () => {
        const [editor] = lexicalReact.useLexicalComposerContext();
        observed.children = editor.read(() =>
          lexical.$getRoot().getChildren().map((node) => ({
            ...(signatureNodes.$isEmailSignatureNode(node)
              ? { signatureId: node.getSignatureId() }
              : {}),
            type: node.getType(),
          })),
        );
        return null;
      },
    };
  },
);

import { ComposerRichTextEditorConnector } from "@/presentation/features/mail-workspace/connectors/composer-rich-text-editor.connector";

describe("composer signature initialization", () => {
  it("creates the nullable reply slot before signature controls mount", () => {
    renderToStaticMarkup(
      createElement(ComposerRichTextEditorConnector, {
        autoFocus: false,
        disabled: false,
        initialHtml: "",
        onChange: vi.fn(),
        signature: {
          initialContentPlacement: "tail",
          onSelectedIdChange: vi.fn(),
          options: [
            {
              body: "Ada",
              id: id.signature("reply"),
              name: "Reply",
            },
          ],
          selectedId: id.signature("reply"),
        },
      }),
    );

    expect(observed.children).toEqual([
      { type: "paragraph" },
      { signatureId: null, type: "email-signature" },
      { type: "paragraph" },
    ]);
  });
});
