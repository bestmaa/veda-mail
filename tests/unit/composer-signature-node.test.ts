import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $nodesOfType,
  createEditor,
  type LexicalEditor,
} from "lexical";
import { describe, expect, it } from "vitest";

import {
  $composerSignatureSlotState,
  $initializeComposerSignatureSlot,
  $placeComposerSignature,
  $removeComposerSignature,
  $restoreComposerSignatureSlot,
} from "@/presentation/features/mail-workspace/composer-signature-editor";
import {
  $createEmailSignatureNode,
  EmailSignatureNode,
} from "@/presentation/features/mail-workspace/composer-signature.node";

const editor = (): LexicalEditor =>
  createEditor({
    namespace: "ComposerSignatureTest",
    nodes: [EmailSignatureNode],
    onError: (error) => {
      throw error;
    },
  });

const paragraph = (text: string) =>
  $createParagraphNode().append($createTextNode(text));

describe("composer signature slot", () => {
  it("keeps a None-to-signature selection after typed new-message content", () => {
    const lexical = editor();
    lexical.update(
      () => {
        $getRoot().append(paragraph("Typed before choosing"));
        $initializeComposerSignatureSlot("prefix");
        const signature = $createEmailSignatureNode("work");
        signature.append(paragraph("Ada Lovelace"));
        $placeComposerSignature(signature);
      },
      { discrete: true },
    );

    lexical.getEditorState().read(() => {
      const children = $getRoot().getChildren();
      expect(children.map((node) => node.getTextContent())).toEqual([
        "Typed before choosing",
        "Ada Lovelace",
      ]);
      expect($nodesOfType(EmailSignatureNode)).toHaveLength(1);
      expect($nodesOfType(EmailSignatureNode)[0]?.getSignatureId()).toBe(
        "work",
      );
    });
  });

  it("keeps a None-to-signature selection between reply prefix and tail", () => {
    const lexical = editor();
    lexical.update(
      () => {
        $getRoot().append(paragraph("On Tuesday, Pat wrote: quoted text"));
        $initializeComposerSignatureSlot("tail");
        const prefix = $getRoot().getFirstChild();
        if (!$isElementNode(prefix)) {
          throw new Error("Missing editable prefix.");
        }
        prefix.append($createTextNode("Thanks, Pat"));
        const signature = $createEmailSignatureNode("reply");
        signature.append(paragraph("Regards,\nAda"));
        $placeComposerSignature(signature);
      },
      { discrete: true },
    );

    lexical.getEditorState().read(() => {
      expect(
        $getRoot().getChildren().map((node) => node.getTextContent()),
      ).toEqual([
        "Thanks, Pat",
        "Regards,\nAda",
        "On Tuesday, Pat wrote: quoted text",
      ]);
      expect($nodesOfType(EmailSignatureNode)).toHaveLength(1);
    });
  });

  it("clears to None without deleting or moving the permanent slot", () => {
    const lexical = editor();
    lexical.update(
      () => {
        $getRoot().append(paragraph("Prefix"));
        $initializeComposerSignatureSlot("prefix");
        const signature = $createEmailSignatureNode("personal");
        signature.append(paragraph("Ada"));
        $placeComposerSignature(signature);
        $removeComposerSignature();
      },
      { discrete: true },
    );

    lexical.getEditorState().read(() => {
      const slots = $nodesOfType(EmailSignatureNode);
      expect(slots).toHaveLength(1);
      expect(slots[0]?.getSignatureId()).toBeNull();
      expect(slots[0]?.getTextContent()).toBe("");
      expect($getRoot().getChildren().map((node) => node.getType())).toEqual([
        "paragraph",
        "email-signature",
      ]);
    });
  });

  it("repairs an accidentally deleted reply slot at its exact boundary", () => {
    const lexical = editor();
    lexical.update(
      () => {
        $getRoot().append(paragraph("Quoted tail"));
        $initializeComposerSignatureSlot("tail");
        const boundary = $composerSignatureSlotState();
        $nodesOfType(EmailSignatureNode)[0]?.remove();
        $restoreComposerSignatureSlot(boundary);
      },
      { discrete: true },
    );

    lexical.getEditorState().read(() => {
      expect($getRoot().getChildren().map((node) => node.getType())).toEqual([
        "paragraph",
        "email-signature",
        "paragraph",
      ]);
      expect($getRoot().getLastChild()?.getTextContent()).toBe("Quoted tail");
    });
  });

  it("repairs a deleted slot from an editor update listener", () => {
    const lexical = editor();
    lexical.update(
      () => {
        $getRoot().append(paragraph("Quoted tail"));
        $initializeComposerSignatureSlot("tail");
      },
      { discrete: true },
    );
    const boundary = lexical.getEditorState().read(
      $composerSignatureSlotState,
    );
    const unregister = lexical.registerUpdateListener(({ editorState }) => {
      if (editorState.read($composerSignatureSlotState).isPresent) return;
      lexical.update(
        () => $restoreComposerSignatureSlot(boundary),
        { discrete: true },
      );
    });

    lexical.update(
      () => $nodesOfType(EmailSignatureNode)[0]?.remove(),
      { discrete: true },
    );
    unregister();

    lexical.getEditorState().read(() => {
      expect($getRoot().getChildren().map((node) => node.getType())).toEqual([
        "paragraph",
        "email-signature",
        "paragraph",
      ]);
    });
  });

  it("serializes the exact selected signature identifier", () => {
    const lexical = editor();
    lexical.update(
      () => {
        $getRoot().append(
          $createEmailSignatureNode("signature-42").append(paragraph("Ada")),
        );
      },
      { discrete: true },
    );

    const json = JSON.stringify(lexical.getEditorState().toJSON());
    expect(json).toContain('"type":"email-signature"');
    expect(json).toContain('"signatureId":"signature-42"');

    const restored = editor();
    restored.setEditorState(restored.parseEditorState(json));
    restored.getEditorState().read(() => {
      expect($nodesOfType(EmailSignatureNode)[0]?.getSignatureId()).toBe(
        "signature-42",
      );
      expect($nodesOfType(EmailSignatureNode)[0]?.getTextContent()).toBe("Ada");
    });
  });
});
