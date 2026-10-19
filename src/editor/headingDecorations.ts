import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { getDocumentNumberedHeadings } from "./documentCache.ts";

const headingDisplayKey = new PluginKey<DecorationSet>("noteFlowHeadingDisplay");
const decorationCache = new WeakMap<ProseMirrorNode, DecorationSet>();

function buildHeadingDecorations(doc: ProseMirrorNode): DecorationSet {
  const cached = decorationCache.get(doc);
  if (cached) return cached;
  const decorations = DecorationSet.create(doc, getDocumentNumberedHeadings(doc)
    .filter(heading => heading.displayNumber)
    .map(heading => Decoration.node(heading.position, heading.position + heading.nodeSize, {
      "data-heading-number": heading.displayNumber,
      ...(heading.numberJoinsText ? { "data-heading-number-join": "true" } : {}),
    })));
  decorationCache.set(doc, decorations);
  return decorations;
}

// View decorations belong to ProseMirror, not saved node attributes. Manual
// React DOM annotations can be discarded by its next view reconciliation.
export const HeadingDisplay = Extension.create({
  name: "noteFlowHeadingDisplay",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: headingDisplayKey,
      state: {
        init: (_, state) => buildHeadingDecorations(state.doc),
        apply: (transaction, previous) => transaction.docChanged ? buildHeadingDecorations(transaction.doc) : previous,
      },
      props: {
        decorations: state => headingDisplayKey.getState(state) ?? DecorationSet.empty,
        attributes: { class: "heading-numbering-enabled" },
      },
    })];
  },
});
