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
  const baseLevel = Math.min(...headings.map(heading => heading.level));
  const edits = headings.flatMap(heading => {
    // Match the existing display policy (chapter + subsection). Deeper titles
    // must not lose a manual ordinal when no automatic number replaces it.
    if (heading.level - baseLevel >= 2) return [];
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
  if (!edits.length) return false;
  const transaction = closeHistory(editor.state.tr);
  for (const edit of [...edits].reverse()) transaction.delete(edit.from, edit.to);
  editor.view.dispatch(transaction);
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.view.focus();
  return true;
}
