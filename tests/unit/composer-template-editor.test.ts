import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $nodesOfType,
  $setSelection,
  createEditor,
  type LexicalEditor,
} from "lexical";
import { describe, expect, it } from "vitest";

import {
  $applyComposerTemplateNodes,
  applyPlainComposerTemplate,
} from "@/presentation/features/mail-workspace/composer-template-editor";
import {
  $createEmailSignatureNode,
  EmailSignatureNode,
} from "@/presentation/features/mail-workspace/composer-signature.node";

const editor = (): LexicalEditor => createEditor({
  namespace: "ComposerTemplateTest",
  nodes: [EmailSignatureNode],
  onError: (error) => { throw error; },
});
const paragraph = (text: string) =>
  $createParagraphNode().append($createTextNode(text));

describe("composer template application", () => {
  it("inserts plain content at the textarea selection", () => {
    const application = { action: "insert" as const, body: "brave ", nonce: 1 };
    expect(applyPlainComposerTemplate("Hello world", application, 6, 6)).toEqual({
      caret: 12,
      text: "Hello brave world",
    });
  });

  it("replaces the complete plain body", () => {
    const application = { action: "replace" as const, body: "New", nonce: 1 };
    expect(applyPlainComposerTemplate("Old quote", application, 2, 4)).toEqual({
      caret: 3,
      text: "New",
    });
  });

  it("replaces rich message nodes while preserving one managed signature", () => {
    const lexical = editor();
    lexical.update(() => {
      $getRoot().append(
        paragraph("Old"),
        $createEmailSignatureNode("work").append(paragraph("Regards")),
        paragraph("Quoted reply"),
      );
      $applyComposerTemplateNodes("replace", [paragraph("Template")]);
    }, { discrete: true });
    lexical.getEditorState().read(() => {
      expect($getRoot().getChildren().map((node) => node.getTextContent())).toEqual([
        "Template",
        "Regards",
      ]);
      expect($nodesOfType(EmailSignatureNode)).toHaveLength(1);
    });
  });

  it("does not delete a signature crossed by an insertion selection", () => {
    const lexical = editor();
    lexical.update(() => {
      const before = paragraph("Before");
      const signature = $createEmailSignatureNode("work").append(paragraph("Regards"));
      const after = paragraph("After");
      $getRoot().append(before, signature, after);
      const selection = $createRangeSelection();
      selection.anchor.set(before.getKey(), 0, "element");
      selection.focus.set(after.getKey(), 1, "element");
      $setSelection(selection);
      $applyComposerTemplateNodes("insert", [paragraph("Template")]);
    }, { discrete: true });
    lexical.getEditorState().read(() => {
      expect($getRoot().getChildren().map((node) => node.getTextContent())).toEqual([
        "Before", "Template", "Regards", "After",
      ]);
      expect($nodesOfType(EmailSignatureNode)).toHaveLength(1);
    });
  });
});
