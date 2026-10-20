import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { createNoteFlowTiptapExtensions } from "../editor/tiptapExtensions";
import { getEditorMarkdown } from "../editor/documentCache";

const extensions = createNoteFlowTiptapExtensions();

/** An isolated document: editing here never invokes the note autosave pipeline. */
export default function EditablePreviewBody({ previewId, content, disabled, onChange, onBlur }: {
  previewId: string;
  content: string;
  disabled: boolean;
  onChange: (content: string) => void;
  onBlur: () => void;
}) {
  const callbacks = useRef({ onChange, onBlur });
  callbacks.current = { onChange, onBlur };
  const localContent = useRef(content);
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

  return <EditorContent editor={editor} />;
}
