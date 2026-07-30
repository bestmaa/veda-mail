import { $isLinkNode } from "@lexical/link";
import type { LexicalNode } from "lexical";

export const nearestComposerLink = (
  node: LexicalNode | null,
): LexicalNode | null => {
  for (let current = node; current; current = current.getParent()) {
    if ($isLinkNode(current)) return current;
  }
  return null;
};
