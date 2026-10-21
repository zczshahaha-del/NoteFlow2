import type { JSONContent } from "@tiptap/core";
import { Heading } from "@tiptap/extension-heading";
import { Plugin } from "@tiptap/pm/state";
import { Mapping, ReplaceStep } from "@tiptap/pm/transform";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { headingNumberPrefixLength } from "../utils/headingNumbering.ts";

/** An old ordinal is formatting metadata, never invisible editable characters.
 * Restore it when saving source, so merely opening a note cannot rewrite it or
 * invalidate an AI preview's source hash. New heading text remains independent. */
export function splitHeadingPrefix(content: JSONContent[] | null = []) {
  content ??= [];
  const text = content.map(node => node.text ?? "\ufffc").join("");
  let remaining = headingNumberPrefixLength(text);
  const prefix: JSONContent[] = [], title: JSONContent[] = [];
  for (const node of content) {
    if (!remaining) { title.push(node); continue; }
    // Only actual text can be an ordinal. Preserve all marks in source metadata.
    if (node.type !== "text") return { prefix: [], title: content };
    const count = Math.min(remaining, node.text!.length);
    if (count) prefix.push({ ...node, text: node.text!.slice(0, count) });
    if (count < node.text!.length) title.push({ ...node, text: node.text!.slice(count) });
    remaining -= count;
  }
  return { prefix, title };
}

export const StructuredHeading = Heading.extend({
  addAttributes() {
    return { ...this.parent?.(), sourcePrefix: { default: null, rendered: false, keepOnSplit: false } };
  },
  parseMarkdown(token, helpers) {
    const { prefix, title } = splitHeadingPrefix(helpers.parseInline(token.tokens || []));
    return helpers.createNode("heading", { level: token.depth || 1, sourcePrefix: prefix.length ? prefix : null }, title);
  },
  renderMarkdown(node, helpers) {
    const prefix = node.content?.length && Array.isArray(node.attrs?.sourcePrefix) ? node.attrs.sourcePrefix as JSONContent[] : [];
    // Coalesce adjacent equivalent text marks before rendering (**一、Docker**
    // must not become **一、****Docker**).
    const content: JSONContent[] = [];
    for (const child of [...prefix, ...(node.content ?? [])]) {
      const previous = content[content.length - 1];
      if (previous?.type === "text" && child.type === "text" && JSON.stringify(previous.marks ?? []) === JSON.stringify(child.marks ?? [])) {
        content[content.length - 1] = { ...previous, text: previous.text! + child.text! };
      } else content.push(child);
    }
    return `${"#".repeat(Number(node.attrs?.level) || 1)} ${helpers.renderChildren(content)}`;
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      appendTransaction(transactions, _old, state) {
        if (editor.isDestroyed || editor.view.composing || !transactions.some(tr => tr.docChanged || tr.getMeta("headingCompositionEnd"))) return null;
        const tr = state.tr;
        const candidates = new Map<number, ProseMirrorNode>();
        const splitHeadings = new Set<number>();
        const collect = (node: ProseMirrorNode, pos: number) => { if (node.type.name === "heading") candidates.set(pos, node); };
        if (transactions.some(tr => tr.getMeta("headingCompositionEnd"))) state.doc.descendants(collect);
        else {
          const mapping = new Mapping();
          transactions.forEach(transaction => mapping.appendMapping(transaction.mapping));
          const steps = transactions.flatMap(transaction => transaction.steps);
          mapping.maps.forEach((map, index) => map.forEach((_from, _to, from, to) => {
            const rest = mapping.slice(index + 1);
            const step = steps[index];
            // PM's mid-block split copies attrs even when keepOnSplit=false.
            // Recognize the exact empty two-wrapper split, not arbitrary paste.
            if (step instanceof ReplaceStep && step.slice.openStart === 1 && step.slice.openEnd === 1
              && step.slice.content.childCount === 2 && step.slice.content.firstChild?.type.name === "heading"
              && step.slice.content.lastChild?.type.name === "heading" && !step.slice.content.firstChild.content.size && !step.slice.content.lastChild.content.size) {
              splitHeadings.add(rest.map(from + 1, -1));
            }
            const start = Math.max(0, rest.map(from, -1) - 1);
            const end = Math.min(state.doc.content.size, rest.map(to, 1) + 1);
            if (end >= start) state.doc.nodesBetween(start, end, collect);
          }));
        }
        for (const [pos, node] of [...candidates].sort(([a], [b]) => a - b)) {
          const { prefix } = splitHeadingPrefix(node.content.toJSON());
          if (!prefix.length) {
            if (splitHeadings.has(pos) && node.attrs.sourcePrefix) tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...node.attrs, sourcePrefix: null });
            continue;
          }
          const length = prefix.reduce((sum, item) => sum + item.text!.length, 0);
          const mapped = tr.mapping.map(pos);
          tr.delete(mapped + 1, mapped + 1 + length);
          tr.setNodeMarkup(mapped, undefined, { ...node.attrs, sourcePrefix: prefix });
        }
        return tr.docChanged ? tr : null;
      },
      props: { handleDOMEvents: { compositionend() {
        // Let the browser/Tiptap finish its final composition transaction first.
        setTimeout(() => {
          if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta("headingCompositionEnd", true));
        }, 0);
        return false;
      } } },
    })];
  },
});
