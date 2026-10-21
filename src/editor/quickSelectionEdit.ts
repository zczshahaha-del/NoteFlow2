import type { Editor } from "@tiptap/core";
import { Slice, type Node } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";

export interface SelectionEditSnapshot {
  from: number;
  to: number;
  doc: Node;
  markdown: string;
}

export function captureSelectionEdit(editor: Editor): SelectionEditSnapshot | null {
  const { from, to, $from, $to } = editor.state.selection;
  if (from === to || !editor.markdown) return null;
  const fragment = editor.state.doc.slice(from, to).content.toJSON();
  const content = $from.sameParent($to) ? [{ type: "paragraph", content: fragment }] : fragment;
  const markdown = editor.markdown.serialize({ type: "doc", content });
  if (!markdown.trim()) return null;
  return { from, to, doc: editor.state.doc, markdown };
}

export function selectionEditIsCurrent(editor: Editor, snapshot: SelectionEditSnapshot): boolean {
  return !editor.isDestroyed && editor.state.doc.eq(snapshot.doc);
}

export function applySelectionEdit(editor: Editor, snapshot: SelectionEditSnapshot, markdown: string): boolean {
  if (!selectionEditIsCurrent(editor, snapshot) || !editor.markdown) return false;
  const parsed = editor.schema.nodeFromJSON(editor.markdown.parse(markdown));
  const sameParent = snapshot.doc.resolve(snapshot.from).sameParent(snapshot.doc.resolve(snapshot.to));
  const slice = !markdown ? Slice.empty : sameParent && parsed.childCount === 1 && parsed.firstChild?.isTextblock
    ? new Slice(parsed.firstChild.content, 0, 0)
    : Slice.maxOpen(parsed.content);
  const tr = closeHistory(editor.state.tr).replaceRange(snapshot.from, snapshot.to, slice);
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.view.focus();
  return true;
}
