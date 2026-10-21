import { Extension, getTextBetween, getTextSerializersFromSchema, type Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { getDocumentNumberedHeadings } from "./documentCache.ts";

const headingDisplayKey = new PluginKey<DecorationSet>("noteFlowHeadingDisplay");
const decorationCache = new WeakMap<ProseMirrorNode, { title: string; decorations: DecorationSet }>();

declare module "@tiptap/core" {
  interface Storage { noteFlowHeadingDisplay: { documentTitle: string } }
}

function buildHeadingDecorations(doc: ProseMirrorNode, title: string): DecorationSet {
  const cached = decorationCache.get(doc);
  if (cached?.title === title) return cached.decorations;
  const decorations = DecorationSet.create(doc, getDocumentNumberedHeadings(doc, title)
    .filter(heading => heading.displayNumber || heading.isDocumentTitle)
    .map(heading => Decoration.node(heading.position, heading.position + heading.nodeSize, {
      ...(heading.displayNumber ? { "data-heading-number": heading.displayNumber } : {}),
      ...(heading.isDocumentTitle ? { "data-document-title": "true" } : {}),
    })));
  decorationCache.set(doc, { title, decorations });
  return decorations;
}

/** Standalone decorative context update, never chained with a content edit. */
export function updateHeadingDocumentTitle(editor: Editor, title: string): boolean {
  if (editor.isDestroyed || editor.storage.noteFlowHeadingDisplay.documentTitle === title) return false;
  // Other plugins may append a trailing empty paragraph on their first
  // transaction. A context update must neither autosave it nor enter history.
  editor.view.dispatch(editor.state.tr.setMeta(headingDisplayKey, title).setMeta("preventUpdate", true).setMeta("addToHistory", false));
  return true;
}

// View decorations belong to ProseMirror, not saved node attributes. Manual
// React DOM annotations can be discarded by its next view reconciliation.
export const HeadingDisplay = Extension.create({
  name: "noteFlowHeadingDisplay",
  priority: 1000,
  addOptions() { return { documentTitle: "" }; },
  addStorage() { return { documentTitle: this.options.documentTitle }; },
  addProseMirrorPlugins() {
    let title = this.options.documentTitle;
    const storage = this.storage;
    return [new Plugin<DecorationSet>({
      key: headingDisplayKey,
      state: {
        init: (_, state) => buildHeadingDecorations(state.doc, title),
        apply: (transaction, previous) => {
          const nextTitle = transaction.getMeta(headingDisplayKey);
          const changed = typeof nextTitle === "string" && nextTitle !== title;
          if (changed) { title = nextTitle; storage.documentTitle = title; }
          return transaction.docChanged || changed ? buildHeadingDecorations(transaction.doc, title) : previous;
        },
      },
      props: {
        transformCopied(slice, view) {
          const ranges = view.state.selection.ranges;
          const headings = getDocumentNumberedHeadings(view.state.doc, title)
            .filter(heading => ranges.some(({ $from, $to }) => heading.position < $to.pos && heading.position + heading.nodeSize > $from.pos));
          let index = 0;
          const decorateCopy = (fragment: Fragment): Fragment => {
            const nodes: ProseMirrorNode[] = [];
            fragment.forEach(node => {
              if (node.type.name === "heading") {
                const heading = headings[index++];
                // Partial title selections keep ordinary text-copy semantics.
                if (heading?.displayNumber && ranges.some(({ $from, $to }) => $from.pos <= heading.position + 1 && $to.pos >= heading.position + heading.nodeSize - 1)) {
                  const prefix = heading.displayNumber + (heading.numberJoinsText ? "" : " ");
                  node = node.type.create({ ...node.attrs, sourcePrefix: null }, Fragment.from(view.state.schema.text(prefix)).append(node.content), node.marks);
                }
              } else if (node.content.size) node = node.copy(decorateCopy(node.content));
              nodes.push(node);
            });
            return Fragment.fromArray(nodes);
          };
          return new Slice(decorateCopy(slice.content), slice.openStart, slice.openEnd);
        },
        clipboardTextSerializer(_slice, view) {
          const headings = getDocumentNumberedHeadings(view.state.doc, title);
          const ranges = [...view.state.selection.ranges].sort((a, b) => a.$from.pos - b.$from.pos);
          const fullySelected = (position: number, nodeSize: number) => ranges.some(({ $from, $to }) => $from.pos <= position + 1 && $to.pos >= position + nodeSize - 1);
          // Let Tiptap retain its normal serializer for text/code/cell copies
          // that contain no complete automatically numbered heading.
          if (!headings.some(h => h.displayNumber && fullySelected(h.position, h.nodeSize))) return "";
          const serializers = getTextSerializersFromSchema(view.state.schema);
          const byPosition = new Map(headings.map(h => [h.position, h]));
          return ranges.map(({ $from, $to }) => getTextBetween(view.state.doc, { from: $from.pos, to: $to.pos }, {
            textSerializers: { ...serializers, heading: ({ node, pos, range }) => {
              const heading = byPosition.get(pos);
              const prefix = heading?.displayNumber && fullySelected(pos, node.nodeSize)
                ? heading.displayNumber + (heading.numberJoinsText ? "" : " ") : "";
              return prefix + getTextBetween(node, {
                from: Math.max(0, range.from - pos - 1), to: Math.min(node.content.size, range.to - pos - 1),
              }, { textSerializers: serializers });
            } },
          })).join("\n\n");
        },
        decorations: state => headingDisplayKey.getState(state) ?? DecorationSet.empty,
        attributes: { class: "heading-numbering-enabled" },
      },
    })];
  },
});
