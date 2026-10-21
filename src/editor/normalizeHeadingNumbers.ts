import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { headingNumberPrefixLength } from "../utils/headingNumbering.ts";
import { getDocumentHeadings } from "./documentCache.ts";

const editsCache = new WeakMap<Node, { from: number; to: number }[]>();

export function headingNumberEdits(doc: Node) {
  const cached = editsCache.get(doc);
  if (cached) return cached;
  const headings = getDocumentHeadings(doc);
  const edits = headings.flatMap(heading => {
    const text = doc.nodeAt(heading.position)?.textContent ?? "";
    const length = headingNumberPrefixLength(text);
    return length ? [{ from: heading.position + 1, to: heading.position + 1 + length }] : [];
  });
  editsCache.set(doc, edits);
  return edits;
}

/** User-invoked formatting: one undo step, ordinary note save/version flow. */
export function normalizeHeadingNumbers(editor: Editor): boolean {
  if (editor.isDestroyed) return false;
  const edits = headingNumberEdits(editor.state.doc);
  const legacy = getDocumentHeadings(editor.state.doc).filter(h => editor.state.doc.nodeAt(h.position)?.attrs.sourcePrefix);
  if (!edits.length && !legacy.length) return false;
  const transaction = closeHistory(editor.state.tr);
  for (const heading of legacy) {
    const node = editor.state.doc.nodeAt(heading.position)!;
    transaction.setNodeMarkup(heading.position, undefined, { ...node.attrs, sourcePrefix: null });
  }
  for (const edit of [...edits].reverse()) transaction.delete(edit.from, edit.to);
  editor.view.dispatch(transaction);
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.view.focus();
  return true;
}
