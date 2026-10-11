import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { numberHeadings, type NumberedHeading } from "../utils/headingNumbering.ts";

export interface TiptapHeading {
  id: string;
  level: number;
  text: string;
  position: number;
  nodeSize: number;
}
const headingCache = new WeakMap<ProseMirrorNode, TiptapHeading[]>();
const numberingCache = new WeakMap<ProseMirrorNode, NumberedHeading<TiptapHeading>[]>();

export function getDocumentHeadings(doc: ProseMirrorNode): TiptapHeading[] {
  const cached = headingCache.get(doc);
  if (cached) return cached;
  const headings: TiptapHeading[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== "heading") return;
    headings.push({
      id: `tiptap-heading-${position}`,
      level: Number(node.attrs.level) || 1,
      text: node.textContent.trim() || "未命名标题",
      position,
      nodeSize: node.nodeSize,
    });
  });
  headingCache.set(doc, headings);
  return headings;
}

export function getDocumentNumberedHeadings(doc: ProseMirrorNode): NumberedHeading<TiptapHeading>[] {
  const cached = numberingCache.get(doc);
  if (cached) return cached;
  const headings = numberHeadings(getDocumentHeadings(doc));
  numberingCache.set(doc, headings);
  return headings;
}

// Retain only the latest serialization for each live editor. Selection-only
// transactions share the immutable document; content/mark changes do not.
const markdownCache = new WeakMap<Editor, { doc: ProseMirrorNode; markdown: string }>();
export function getEditorMarkdown(editor: Editor): string {
  const doc = editor.state.doc;
  const cached = markdownCache.get(editor);
  if (cached?.doc === doc) return cached.markdown;
  const markdown = editor.getMarkdown();
  markdownCache.set(editor, { doc, markdown });
  return markdown;
}
