import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { getDocumentNumberedHeadings } from "./documentCache.ts";

interface HeadingDisplayState {
  enabled: boolean;
  decorations: DecorationSet;
}
const headingDisplayKey = new PluginKey<HeadingDisplayState>("noteFlowHeadingDisplay");
const decorationCache = new WeakMap<ProseMirrorNode, DecorationSet>();

function buildHeadingDecorations(doc: ProseMirrorNode): DecorationSet {
  const cached = decorationCache.get(doc);
  if (cached) return cached;
  const decorations = DecorationSet.create(doc, getDocumentNumberedHeadings(doc)
    .filter(heading => heading.displayNumber)
    .map(heading => Decoration.node(heading.position, heading.position + heading.nodeSize, {
      "data-heading-number": heading.displayNumber,
    })));
  decorationCache.set(doc, decorations);
  return decorations;
}

// View decorations belong to ProseMirror, not saved node attributes. Manual
// React DOM annotations can be discarded by its next view reconciliation.
export const HeadingDisplay = Extension.create({
  name: "noteFlowHeadingDisplay",
  addProseMirrorPlugins() {
    return [new Plugin<HeadingDisplayState>({
      key: headingDisplayKey,
      state: {
        init: (_, state) => ({ enabled: true, decorations: buildHeadingDecorations(state.doc) }),
        apply: (transaction, previous) => {
          const setting: unknown = transaction.getMeta(headingDisplayKey);
          const enabled = typeof setting === "boolean" ? setting : previous.enabled;
          if (!transaction.docChanged && enabled === previous.enabled) return previous;
          return { enabled, decorations: enabled ? buildHeadingDecorations(transaction.doc) : DecorationSet.empty };
        },
      },
      props: {
        decorations: state => headingDisplayKey.getState(state)?.decorations ?? DecorationSet.empty,
        attributes: state => ({ class: headingDisplayKey.getState(state)?.enabled ? "heading-numbering-enabled" : "" }),
      },
    })];
  },
});

export function setHeadingNumbering(editor: Editor, enabled: boolean): void {
  if (editor.isDestroyed || headingDisplayKey.getState(editor.state)?.enabled === enabled) return;
  editor.view.dispatch(editor.state.tr.setMeta(headingDisplayKey, enabled).setMeta("addToHistory", false));
}
