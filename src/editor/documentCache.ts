import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { numberHeadings, type NumberedHeading } from "../utils/headingNumbering.ts";
import { hasMatchingDocumentTitle } from "../utils/documentHeader.ts";

export interface TiptapHeading {
  id: string;
  level: number;
  text: string;
  position: number;
  nodeSize: number;
}
const headingCache = new WeakMap<ProseMirrorNode, TiptapHeading[]>();
const numberingCache = new WeakMap<ProseMirrorNode, { title: string; headings: NumberedHeading<TiptapHeading>[] }>();

export function getDocumentHeadings(doc: ProseMirrorNode): TiptapHeading[] {
  const cached = headingCache.get(doc);
  if (cached) return cached;
  const headings: TiptapHeading[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== "heading") return;
    if (!node.textContent.trim()) return; // An unfinished empty heading is not an outline entry.
    headings.push({
      id: `tiptap-heading-${position}`,
      level: Number(node.attrs.level) || 1,
      text: node.textContent.trim(),
      position,
      nodeSize: node.nodeSize,
    });
  });
  headingCache.set(doc, headings);
  return headings;
}

export function getDocumentNumberedHeadings(doc: ProseMirrorNode, documentTitle = ""): NumberedHeading<TiptapHeading>[] {
  const cached = numberingCache.get(doc);
  if (cached?.title === documentTitle) return cached.headings;
  const all = getDocumentHeadings(doc);
  const firstIsTitle = hasMatchingDocumentTitle(documentTitle, doc.firstChild);
  const headings = numberHeadings(firstIsTitle ? all.filter(h => h.position !== 0) : all);
  if (firstIsTitle && all[0]?.position === 0) headings.unshift({ ...all[0], displayNumber: "", numberJoinsText: false, hasManualNumber: false, hierarchyDepth: -1, isDocumentTitle: true });
  numberingCache.set(doc, { title: documentTitle, headings });
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
