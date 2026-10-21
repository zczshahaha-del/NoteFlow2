import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { createNoteFlowTiptapExtensions } from "../editor/tiptapExtensions";
import { getEditorMarkdown } from "../editor/documentCache";
import { updateHeadingDocumentTitle } from "../editor/headingDecorations";
import { PreviewReview, updatePreviewReview } from "../editor/previewReview";

/** An isolated document: editing here never invokes the note autosave pipeline. */
export default function EditablePreviewBody({ previewId, content, oldContent, showComparison, disabled, onChange, onBlur, documentTitle = "" }: {
  previewId: string;
  content: string;
  oldContent: string;
  showComparison: boolean;
  disabled: boolean;
  onChange: (content: string) => void;
  onBlur: () => void;
  documentTitle?: string;
}) {
  // Preserve the same editor on title/context changes; update decorations below.
  const extensions = useMemo(() => [...createNoteFlowTiptapExtensions(documentTitle), PreviewReview], [previewId]);
  const callbacks = useRef({ onChange, onBlur });
  callbacks.current = { onChange, onBlur };
  const localContent = useRef(content);
  const expandedOriginals = useRef(new Set<string>());
  const editor = useEditor({
    extensions,
    content,
    contentType: "markdown",
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: "note-content nf-edit-document outline-none",
        "aria-label": "修改稿正文",
        "role": "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = getEditorMarkdown(current);
      localContent.current = markdown;
      callbacks.current.onChange(markdown);
    },
    onBlur: () => callbacks.current.onBlur(),
  }, [previewId]);

  useEffect(() => {
    if (editor) updateHeadingDocumentTitle(editor, documentTitle);
  }, [editor, documentTitle]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled, false);
    editor.view.dom.setAttribute("aria-readonly", String(disabled));
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || content === localContent.current) return;
    // Only an external AI result / restored version replaces this document.
    // Acknowledging a manual save must preserve its native undo and caret.
    localContent.current = content;
    const parsed = editor.markdown!.parse(content);
    const doc = editor.schema.nodeFromJSON(parsed);
    editor.view.updateState(EditorState.create({ schema: editor.schema, doc, plugins: editor.state.plugins }));
  }, [editor, content]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // Keep composition and typing synchronous; comparison is decorative work.
    const timer = window.setTimeout(() => {
      if (!editor.isDestroyed && !editor.view.composing) updatePreviewReview(editor, oldContent, content, showComparison, expandedOriginals.current);
    }, showComparison ? 120 : 0);
    return () => window.clearTimeout(timer);
  }, [editor, oldContent, content, showComparison]);

  return <div role={showComparison ? "region" : undefined} aria-label={showComparison ? "段落对照" : undefined}>
    <EditorContent editor={editor} />
  </div>;
}
