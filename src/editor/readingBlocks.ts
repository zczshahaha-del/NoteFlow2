import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { readingCalloutKind } from "../utils/readingCallout.ts";

type Cue = { from: number; to: number; kind: string };
// Unchanged immutable subtrees keep their result. Do not traverse code text or
// rescan paragraphs, and do not create any transaction on load/selection.
const cues = new WeakMap<ProseMirrorNode, Cue[]>();
function collect(node: ProseMirrorNode): Cue[] {
  const cached = cues.get(node);
  if (cached) return cached;
  const result: Cue[] = [];
  if (!node.isTextblock) node.forEach((child, offset) => {
    if (child.type.name === "blockquote") {
      const kind = readingCalloutKind(child.firstChild?.type.name === "paragraph" ? child.firstChild.textContent : "");
      if (kind) result.push({ from: offset, to: offset + child.nodeSize, kind });
    }
    if (!child.isTextblock && !child.isLeaf) {
      for (const cue of collect(child)) result.push({ ...cue, from: cue.from + offset + 1, to: cue.to + offset + 1 });
    }
  });
  cues.set(node, result);
  return result;
}
function decorate(doc: ProseMirrorNode): DecorationSet {
  return DecorationSet.create(doc, collect(doc).map(cue => Decoration.node(cue.from, cue.to, { "data-reading-callout": cue.kind })));
}
const key = new PluginKey<DecorationSet>("reading-blocks");
export const ReadingBlocks = Extension.create({
  name: "readingBlocks",
  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      state: { init: (_, state) => decorate(state.doc), apply: (transaction, old) => transaction.docChanged ? decorate(transaction.doc) : old },
      props: { decorations: state => key.getState(state) },
    })];
  },
});
