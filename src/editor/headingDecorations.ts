import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { hasMatchingDocumentTitle } from "../utils/documentHeader.ts";

const titleKey = new PluginKey<DecorationSet>("noteFlowDocumentTitle");
declare module "@tiptap/core" {
  interface Storage { noteFlowDocumentTitle: { documentTitle: string } }
}

/** Title typography only. No numbering, text rewriting or clipboard overrides. */
export const DocumentTitleDisplay = Extension.create({
  name: "noteFlowDocumentTitle",
  addOptions() { return { documentTitle: "" }; },
  addStorage() { return { documentTitle: this.options.documentTitle }; },
  addProseMirrorPlugins() {
    let title = this.options.documentTitle;
    const storage = this.storage;
    const decorate = (doc: Editor["state"]["doc"]) => hasMatchingDocumentTitle(title, doc.firstChild)
      ? DecorationSet.create(doc, [Decoration.node(0, doc.firstChild!.nodeSize, { "data-document-title": "true" })])
      : DecorationSet.empty;
    return [new Plugin<DecorationSet>({
      key: titleKey,
      state: {
        init: (_, state) => decorate(state.doc),
        apply: (tr, previous) => {
          const next = tr.getMeta(titleKey);
          const changed = typeof next === "string" && next !== title;
          if (changed) { title = next; storage.documentTitle = title; }
          return tr.docChanged || changed ? decorate(tr.doc) : previous;
        },
      },
      props: { decorations: state => titleKey.getState(state) ?? DecorationSet.empty },
    })];
  },
});

export function updateHeadingDocumentTitle(editor: Editor, title: string): boolean {
  if (editor.isDestroyed || editor.storage.noteFlowDocumentTitle.documentTitle === title) return false;
  editor.view.dispatch(editor.state.tr.setMeta(titleKey, title).setMeta("preventUpdate", true).setMeta("addToHistory", false));
  return true;
}
