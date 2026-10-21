import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Code2,
  Highlighter,
  Italic,
  Link,
  List,
  ListOrdered,
  Menu,
  MessageSquarePlus,
  Quote,
  RefreshCw,
  Strikethrough,
  Sparkles,
  Underline as UnderlineIcon,
  X,
} from "lucide-react";
import { useEditorSlice } from "../store/selectors";
import DocumentHeader from "./DocumentHeader";
import NoteOpeningStatus from "./NoteOpeningStatus";
import "./document-prose.css";
import "./selection-toolbar.css";
import "./mobile-note-navigation.css";
import { findFileById } from "../workspaceTree";
import { createNoteFlowTiptapExtensions } from "../editor/tiptapExtensions";
import { findTiptapTextRange } from "../utils/tiptapSelection";
import OutlinePanel from "./OutlinePanel";
import ChapterRail from "./ChapterRail";
import { useReadingHeading } from "../hooks/useReadingHeading";
import { useHeadingGroups } from "../hooks/useHeadingGroups";
import { attachmentMarkdown, uploadAttachment } from "../services/attachments";
import { OperationFeedback } from './OperationFeedback';
import { getNoteOutline, type NoteSectionRecord } from "../services/notes";
import { hasMatchingDocumentTitle } from "../utils/documentHeader";
import { getDocumentHeadings, getDocumentNumberedHeadings, getEditorMarkdown, type TiptapHeading } from "../editor/documentCache";
import { captureSelectionEdit, type SelectionEditSnapshot } from "../editor/quickSelectionEdit";
import SelectionQuickEdit from "./SelectionQuickEdit";
import { headingNumberEdits, normalizeHeadingNumbers } from "../editor/normalizeHeadingNumbers";

const VersionHistoryPanel = lazy(() => import("./VersionHistoryPanel"));
const extensions = createNoteFlowTiptapExtensions();
const selectionToolbarAppendTo = () => document.body;
const selectionToolbarShouldShow = ({
  editor,
  from,
  to,
}: {
  editor: Editor;
  from: number;
  to: number;
}) => from !== to && !editor.isActive("codeBlock");
const selectionToolbarOptions = {
  strategy: "fixed",
  placement: "top",
  offset: 10,
  flip: false,
  shift: { padding: 12 },
} as const;

const emptyHeadings: TiptapHeading[] = [];

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function collectHeadings(editor: Editor): TiptapHeading[] {
  return getDocumentHeadings(editor.state.doc);
}

function markdownPlainText(editor: Editor, markdown: string): string {
  if (!markdown.trim() || !editor.markdown) return "";
  const parsed = editor.markdown.parse(markdown);
  const text: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as { text?: unknown; content?: unknown };
    if (typeof record.text === "string") text.push(record.text);
    if (Array.isArray(record.content)) record.content.forEach(visit);
  };
  visit(parsed);
  return text.join("").replace(/\s+/g, " ").trim();
}

function focusEditorSource(editor: Editor, position: number) {
  const safePosition = Math.max(1, Math.min(position, editor.state.doc.content.size));
  editor.chain().focus().setTextSelection(safePosition).scrollIntoView().run();
  window.requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    const domAtPosition = editor.view.domAtPos(safePosition).node;
    const element = domAtPosition instanceof HTMLElement
      ? domAtPosition
      : domAtPosition.parentElement;
    const target = element?.closest<HTMLElement>("p, h1, h2, h3, h4, li, blockquote, pre") ?? element;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("source-focus-highlight");
    window.setTimeout(() => target.classList.remove("source-focus-highlight"), 1600);
  });
}

function smoothScrollToEditorHeading(editor: Editor, position: number) {
  const targetNode = editor.view.nodeDOM(position);
  const target = targetNode instanceof HTMLElement
    ? targetNode
    : targetNode?.parentElement;
  const scroller = editor.view.dom.closest<HTMLElement>(".document-scroll");
  if (!target || !scroller) {
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const targetTop =
    target.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop -
    24;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  scroller.scrollTo({
    top: Math.max(0, targetTop),
    behavior: reduceMotion ? "auto" : "smooth",
  });
}

function SelectionToolbarButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`selection-toolbar-button ${active ? "is-active" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function NoteSelectionToolbar({
  editor,
  onAddToChat,
  onAddLink,
  onQuickEdit,
}: {
  editor: Editor;
  onAddToChat: () => void;
  onAddLink: () => void;
  onQuickEdit: () => void;
}) {
  // Keep selection formatting reactive without redrawing the note, outline
  // and chapter rail for every caret move. Only these primitive flags matter.
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      highlight: current.isActive("highlight"),
      code: current.isActive("code"),
      link: current.isActive("link"),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      blockquote: current.isActive("blockquote"),
    }),
  });
  return (
    <>
      <button type="button" className="selection-toolbar-button selection-ai-button" onMouseDown={event => event.preventDefault()} onClick={onQuickEdit} aria-label="AI 改一下"><Sparkles size={15} />AI 改一下</button>
      <SelectionToolbarButton label="加入对话" onClick={onAddToChat}>
        <MessageSquarePlus size={15} />
      </SelectionToolbarButton>
      <span className="selection-toolbar-divider" aria-hidden="true" />
      <SelectionToolbarButton label="加粗" active={active.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={15} />
      </SelectionToolbarButton>
      <SelectionToolbarButton label="斜体" active={active.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={15} />
      </SelectionToolbarButton>
      <SelectionToolbarButton label="下划线" active={active.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon size={15} />
      </SelectionToolbarButton>
      <SelectionToolbarButton label="删除线" active={active.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={15} />
      </SelectionToolbarButton>
      <SelectionToolbarButton label="高亮" active={active.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()}>
        <Highlighter size={15} />
      </SelectionToolbarButton>
      <SelectionToolbarButton label="行内代码" active={active.code} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code2 size={15} />
      </SelectionToolbarButton>
      <SelectionToolbarButton label={active.link ? "取消链接" : "添加链接"} active={active.link} onClick={() => {
        if (editor.isActive("link")) editor.chain().focus().unsetLink().run();
        else onAddLink();
      }}>
        <Link size={15} />
      </SelectionToolbarButton>
      <span className="selection-toolbar-divider" aria-hidden="true" />
      <SelectionToolbarButton label="无序列表" active={active.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={15} />
      </SelectionToolbarButton>
      <SelectionToolbarButton label="有序列表" active={active.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={15} />
      </SelectionToolbarButton>
      <SelectionToolbarButton label="引用" active={active.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={15} />
      </SelectionToolbarButton>
      <SelectionToolbarButton label="清除格式" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <RefreshCw size={15} />
      </SelectionToolbarButton>
    </>
  );
}

export default function NoteEditor() {
  const { selectedFileId, treeData, fileContents, noteOpenError, setSelectedFileId } = useEditorSlice();
  const file = selectedFileId ? findFileById(treeData, selectedFileId) : undefined;
  if (!file) return <NoteEditorDocument />;
  return (
    <NoteEntry key={file.id}
      hasContent={fileContents[file.id] !== undefined || file.content !== undefined}
      error={noteOpenError?.noteId === file.id}
      onRetry={() => setSelectedFileId(file.id)} />
  );
}

function NoteEntry({ hasContent, error, onRetry }: {
  hasContent: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const failed = error && !hasContent;
  const onReady = useCallback(() => setReady(true), []);
  useEffect(() => {
    if (!hasContent) return;
    // Let selection/drawer feedback paint before synchronously parsing the new note.
    // Keyed ownership cancels superseded opens; never render the old editor under a new title.
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setMounted(true));
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [hasContent]);
  return (
    <div className="note-entry" data-ready={ready} aria-busy={!ready && !failed}>
      {!ready && <NoteOpeningStatus error={failed} onRetry={onRetry} />}
      {mounted && <div className="note-entry-content" inert={!ready} aria-hidden={!ready}>
        <NoteEditorDocument onReady={onReady} presented={ready} />
      </div>}
    </div>
  );
}

function NoteEditorDocument({ onReady, presented = true }: {
  onReady?: () => void;
  presented?: boolean;
}) {
  const {
    selectedFileId,
    treeData,
    fileContents,
    noteSaveState,
    retryNoteSave,
    pendingEditorSelection,
    pendingSourceFocus,
    updateFileContent,
    updateNodeName,
    reindexNote,
    addSelectionToChat,
    clearPendingEditorSelection,
    clearPendingSourceFocus,
    setActiveEditorSectionId,
  } = useEditorSlice();
  const selectedFile = selectedFileId ? findFileById(treeData, selectedFileId) : undefined;
  const rawContent = selectedFile
    ? (fileContents[selectedFile.id] ?? selectedFile.content ?? "")
    : "";
  const [titleDraft, setTitleDraft] = useState(
    selectedFile?.name.replace(/\.md$/i, "") ?? "未命名笔记"
  );
  const titleEditingRef = useRef(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [mobileOutlineOpen, setMobileOutlineOpen] = useState(false);
  const [bodyEditing, setBodyEditing] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [quickEdit, setQuickEdit] = useState<{ editor: Editor; snapshot: SelectionEditSnapshot } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const uploadQueueRef = useRef<File[]>([]);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const [backendSections, setBackendSections] = useState<NoteSectionRecord[]>([]);
  const [documentScroller, setDocumentScroller] = useState<HTMLDivElement | null>(null);
  const toolbarOptions = useMemo(() => ({ ...selectionToolbarOptions, scrollTarget: documentScroller ?? undefined }), [documentScroller]);
  const isMobile = useMediaQuery("(max-width: 767px)");

  const editor = useEditor(
    {
      extensions,
      content: rawContent,
      contentType: "markdown",
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      onFocus: () => setBodyEditing(true),
      onBlur: () => setBodyEditing(false),
      editorProps: {
        attributes: {
          class: "note-content min-h-[56vh] outline-none",
          "data-testid": "tiptap-editor-content",
          "aria-label": "笔记正文",
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        if (!selectedFileId) return;
        updateFileContent(selectedFileId, getEditorMarkdown(currentEditor));
      },
    },
    [selectedFileId]
  );

  useEffect(() => () => {
    uploadControllerRef.current?.abort(); uploadQueueRef.current = [];
  }, [selectedFileId]);

  useEffect(() => { setQuickEdit(null); }, [editor]);
  const showSelectionToolbar = useCallback((props: Parameters<typeof selectionToolbarShouldShow>[0]) =>
    quickEdit?.editor !== props.editor && selectionToolbarShouldShow(props), [quickEdit]);

  const documentState = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      doc: current && !current.isDestroyed ? current.state.doc : null,
    }),
    // Compare immutable doc identity, not a deep traversal of the whole note.
    equalityFn: (previous, next) =>
      previous.doc === next?.doc,
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || !onReady) return;
    const frame = requestAnimationFrame(onReady);
    return () => cancelAnimationFrame(frame);
  }, [editor, onReady]);

  useEffect(() => {
    // Metadata acknowledgements must not replace a title draft under its caret.
    if (!titleEditingRef.current) setTitleDraft(selectedFile?.name.replace(/\.md$/i, "") ?? "未命名笔记");
    setVersionHistoryOpen(false);
    setMobileOutlineOpen(false);
  }, [selectedFile?.id, selectedFile?.name]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || getEditorMarkdown(editor) === rawContent) return;
    editor.commands.setContent(rawContent, { contentType: "markdown", emitUpdate: false });
  }, [editor, rawContent]);

  useEffect(() => {
    if (
      !editor ||
      editor.isDestroyed ||
      !presented ||
      !pendingEditorSelection ||
      pendingEditorSelection.noteId !== selectedFileId
    ) return;
    const target = markdownPlainText(editor, pendingEditorSelection.markdown);
    const range = pendingEditorSelection.mode === "select" ? findTiptapTextRange(editor.state.doc, target) : null;
    const command = editor.chain().focus();
    if (range) command.setTextSelection(range);
    else command.setTextSelection(1);
    command.scrollIntoView().run();
    clearPendingEditorSelection();
  }, [clearPendingEditorSelection, editor, pendingEditorSelection, presented, rawContent, selectedFileId]);

  useEffect(() => {
    if (
      !editor ||
      editor.isDestroyed ||
      !presented ||
      !pendingSourceFocus ||
      pendingSourceFocus.noteId !== selectedFileId
    ) return;
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const pathTitle =
      pendingSourceFocus.sectionPath?.[pendingSourceFocus.sectionPath.length - 1]?.trim();
    const sectionTitle = (
      pathTitle ||
      pendingSourceFocus.sectionTitle?.split("/").pop() ||
      ""
    ).trim();
    const editorHeadings = collectHeadings(editor);
    const heading = sectionTitle
      ? editorHeadings.find((item) => normalize(item.text) === normalize(sectionTitle)) ??
        editorHeadings.find((item) => {
          const headingText = normalize(item.text);
          const sourceText = normalize(sectionTitle);
          return headingText.includes(sourceText) || sourceText.includes(headingText);
        })
      : undefined;

    if (heading) {
      const from = Math.min(heading.position + 1, editor.state.doc.content.size);
      focusEditorSource(editor, from);
    } else {
      const sourceLines =
        Number.isInteger(pendingSourceFocus.startLine) &&
        Number.isInteger(pendingSourceFocus.endLine) &&
        (pendingSourceFocus.endLine as number) > (pendingSourceFocus.startLine as number)
          ? rawContent
              .split(/\r?\n/)
              .slice(
                pendingSourceFocus.startLine as number,
                pendingSourceFocus.endLine as number
              )
              .join("\n")
          : "";
      const plainSnippet = markdownPlainText(
        editor,
        sourceLines || pendingSourceFocus.snippet || ""
      )
        .replace(/^\.{3}|\.{3}$/g, "")
        .trim();
      const centeredSnippet = (length: number) => {
        if (plainSnippet.length <= length) return plainSnippet;
        const start = Math.max(0, Math.floor((plainSnippet.length - length) / 2));
        return plainSnippet.slice(start, start + length).trim();
      };
      const candidates = [
        centeredSnippet(120),
        centeredSnippet(72),
        plainSnippet,
        plainSnippet.slice(0, 72),
        sectionTitle,
      ].filter((value, index, values) => value && values.indexOf(value) === index);
      const range = candidates
        .map((candidate) => findTiptapTextRange(editor.state.doc, candidate))
        .find(Boolean);
      if (range) focusEditorSource(editor, range.from);
      else focusEditorSource(editor, 1);
    }
    clearPendingSourceFocus();
  }, [clearPendingSourceFocus, editor, pendingSourceFocus, presented, rawContent, selectedFileId]);

  const headings = useMemo(
    () => editor && !editor.isDestroyed ? collectHeadings(editor) : emptyHeadings,
    [editor, documentState?.doc]
  );
  const numberedHeadings = useMemo(
    () => editor && !editor.isDestroyed ? getDocumentNumberedHeadings(editor.state.doc) : [],
    [editor, headings]
  );
  const visibleHeadings = numberedHeadings;
  const canNormalizeHeadingNumbers = useMemo(() => Boolean(documentState?.doc && headingNumberEdits(documentState.doc).length), [documentState?.doc]);
  const activeId = useReadingHeading(editor, documentScroller, headings);
  const headingGroups = useHeadingGroups(visibleHeadings, activeId);
  const headingPositions = useMemo(
    () => new Map(headings.map((heading) => [heading.id, heading.position])),
    [headings]
  );
  useEffect(() => {
    setBackendSections([]);
    setActiveEditorSectionId(null);
  }, [selectedFileId, setActiveEditorSectionId]);
  useEffect(() => {
    let alive = true;
    if (!selectedFileId) return;
    // Saving/typing does not create a new indexed outline. Keep the current
    // section context until the note changes or a fresh index becomes available.
    if (selectedFile?.indexStatus === "outdated" || selectedFile?.indexStatus === "indexing") return;
    void getNoteOutline(selectedFileId)
      .then((outline) => { if (alive) setBackendSections(outline.sections); })
      .catch(() => { if (alive) setBackendSections([]); });
    return () => { alive = false; };
  }, [selectedFile?.indexStatus, selectedFile?.updatedAt, selectedFileId]);

  useEffect(() => {
    const heading = headings.find((item) => item.id === activeId);
    const normalized = heading?.text.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";
    const section = normalized
      ? backendSections.find(
          (item) => item.title.trim().replace(/\s+/g, " ").toLocaleLowerCase() === normalized
        )
      : null;
    setActiveEditorSectionId(section?.id ?? null);
  }, [activeId, backendSections, headings, setActiveEditorSectionId]);
  const indexStatus = selectedFile?.indexStatus ?? "pending";
  const indexLabel =
    indexStatus === "indexed"
      ? "已完成"
      : indexStatus === "indexing"
        ? "更新中"
        : indexStatus === "failed"
          ? "失败"
          : indexStatus === "outdated"
            ? "待更新"
            : "待解析";
  const matchingBodyTitle = hasMatchingDocumentTitle(titleDraft, documentState?.doc?.firstChild);

  if (!selectedFile) {
    return (
      <main className="document-empty-state flex min-w-0 flex-1 items-center justify-center bg-white px-8 text-center">
        <div>
          <p className="text-[18px] font-semibold text-jelly-text">选择一篇笔记开始阅读</p>
          <p className="mt-2 text-[13px] text-jelly-text-muted">从左侧目录打开笔记，或新建一篇笔记。</p>
        </div>
      </main>
    );
  }

  if (!editor || editor.isDestroyed) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center bg-white text-sm text-jelly-text-muted">
        正在打开笔记…
      </main>
    );
  }

  const scrollToHeading = (id: string) => {
    const position = headingPositions.get(id);
    if (position === undefined) return;
    const selectionPosition = Math.min(position + 1, editor.state.doc.content.size);
    editor.commands.setTextSelection(selectionPosition);
    window.requestAnimationFrame(() => {
      if (!editor.isDestroyed) smoothScrollToEditorHeading(editor, position);
    });
    if (mobileOutlineOpen) setMobileOutlineOpen(false);
  };

  const addCurrentSelectionToChat = () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, " ").trim();
    if (!text) return;
    addSelectionToChat({
      text,
      noteId: selectedFile.id,
      noteTitle: titleDraft || selectedFile.name.replace(/\.md$/i, ""),
    });
  };

  const insertAttachmentMarkdown = (markdown: string) => {
    editor.commands.insertContent(`\n\n${markdown}`, { contentType: "markdown" });
  };

  const uploadEditorFiles = async (files: File[]) => {
    uploadQueueRef.current.push(...files);
    if (uploadControllerRef.current && !uploadControllerRef.current.signal.aborted) return;
    const controller = new AbortController(); uploadControllerRef.current = controller;
    setUploadBusy(true); setUploadError('');
    try {
      while (uploadQueueRef.current.length) {
        const file = uploadQueueRef.current[0];
        const item = await uploadAttachment(file, selectedFile.id, controller.signal);
        if (controller.signal.aborted || editor.isDestroyed) return;
        insertAttachmentMarkdown(attachmentMarkdown(item));
        uploadQueueRef.current.shift();
      }
    } catch (error) {
      if (!controller.signal.aborted && !editor.isDestroyed) setUploadError(error instanceof Error ? error.message : '文件上传未完成');
    } finally {
      if (uploadControllerRef.current === controller) { uploadControllerRef.current = null; if (!editor.isDestroyed) setUploadBusy(false); }
    }
  };

  const applyLink = () => {
    const href = linkDraft.trim();
    if (!href) return;
    const normalized = /^https?:\/\//i.test(href) ? href : `https://${href}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
    setLinkDraft("");
    setLinkOpen(false);
  };

  const outline = (
    <OutlinePanel
      headings={visibleHeadings}
      groups={headingGroups}
      activeId={activeId}
      onHeadingClick={scrollToHeading}
      onClose={() => setMobileOutlineOpen(false)}
    />
  );

  return (
    <main className="document-editor document-canvas nf-prose-refined relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
      {isMobile && <div className="mobile-note-header" role="toolbar" aria-label="笔记导航">
        <span className="mobile-note-name">{titleDraft || "未命名笔记"}</span>
        {headings.length > 1 ? <button type="button" className="mobile-note-outline"
          onClick={() => setMobileOutlineOpen(true)} aria-label="展开目录"><Menu size={18} /></button> : <span className="mobile-note-outline-space" />}
      </div>}
      <div className="relative flex min-h-0 flex-1">
        {mobileOutlineOpen && (
          <div className="absolute inset-0 z-[65] flex justify-end" role="dialog" aria-modal="true" aria-label="本文目录">
            <button type="button" className="drawer-backdrop absolute inset-0" onClick={() => setMobileOutlineOpen(false)} aria-label="关闭本文目录" />
            <aside className="drawer-surface relative h-full w-[340px] max-w-[86vw] border-l border-jelly-border shadow-[-18px_0_46px_rgba(15,23,42,0.08)]">{outline}</aside>
          </div>
        )}

        <section className="flex min-w-0 flex-1 flex-col">

          {linkOpen && (
            <div className="document-inline-panel flex items-center gap-2 border-b border-jelly-border/70 bg-white px-3 py-2">
              <Link size={14} className="text-jelly-blue-deep" />
              <input
                value={linkDraft}
                onChange={(event) => setLinkDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyLink();
                  if (event.key === "Escape") setLinkOpen(false);
                }}
                className="document-inline-input h-8 flex-1 border-0 border-b border-jelly-border bg-transparent px-1 text-[13px] text-jelly-text outline-none"
                placeholder="输入链接地址"
                aria-label="链接地址"
                autoFocus
              />
              <button type="button" className="ui-button ui-button-primary h-8" onClick={applyLink} disabled={!linkDraft.trim()}>应用</button>
              <button type="button" className="ui-button ui-button-ghost h-8 w-8 px-0" onClick={() => setLinkOpen(false)} aria-label="取消添加链接"><X size={14} /></button>
            </div>
          )}

          <div className="min-h-0 flex-1">
            <div ref={setDocumentScroller} className="document-scroll h-full overflow-y-auto px-7 pb-32 pt-20 sm:px-10 xl:px-0">
              <article className="note-page mx-auto max-w-[780px]">
                <DocumentHeader note={selectedFile} title={titleDraft}
                  onTitleChange={setTitleDraft}
                  onTitleEditingChange={editing => { titleEditingRef.current = editing; }}
                  onTitleCommit={(value) => {
                    const name = value.trim() || "未命名笔记";
                    setTitleDraft(name);
                    if (name !== selectedFile.name.replace(/\.md$/i, "")) updateNodeName(selectedFile.id, name + ".md");
                  }}
                  matchingBodyTitle={matchingBodyTitle} bodyEditing={bodyEditing}
                  onNormalizeHeadings={canNormalizeHeadingNumbers && editor ? () => normalizeHeadingNumbers(editor) : undefined} />
                {(noteSaveState.status === 'error' || noteSaveState.status === 'offline') && <div className="nf-note-feedback">
                  <OperationFeedback onRetry={() => retryNoteSave(selectedFile.id)} retryLabel={noteSaveState.status === 'offline' ? '立即同步' : '重试保存'}>
                    <strong>{noteSaveState.status === 'offline' ? '正文已留在本机，等待同步' : '正文未能同步到服务器'}</strong>
                    <span>{noteSaveState.message || '请检查连接后重试；当前输入不会被清空。'}</span>
                  </OperationFeedback>
                </div>}
                {uploadError && <div className="nf-note-feedback"><OperationFeedback busy={uploadBusy} onRetry={() => { void uploadEditorFiles([]); }} retryLabel="重试上传">
                  <strong>文件上传未完成</strong><span>{uploadError}</span>
                </OperationFeedback></div>}
                <div
                  onPasteCapture={(event) => {
                    const files = Array.from(event.clipboardData.files);
                    if (!files.length) return;
                    event.preventDefault();
                    void uploadEditorFiles(files);
                  }}
                  onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
                  onDrop={(event) => {
                    const files = Array.from(event.dataTransfer.files);
                    if (!files.length) return;
                    event.preventDefault();
                    void uploadEditorFiles(files);
                  }}
                >
                  {documentScroller && <BubbleMenu
                    editor={editor}
                    pluginKey="noteSelectionToolbar"
                    appendTo={selectionToolbarAppendTo}
                    shouldShow={showSelectionToolbar}
                    options={toolbarOptions}
                    className="selection-toolbar tiptap-selection-toolbar"
                    data-quick-edit-open={quickEdit?.editor === editor ? "true" : undefined}
                    aria-label="选中文字格式工具栏"
                  >
                    <NoteSelectionToolbar
                      editor={editor}
                      onAddToChat={addCurrentSelectionToChat}
                      onAddLink={() => setLinkOpen(true)}
                      onQuickEdit={() => {
                        const snapshot = captureSelectionEdit(editor);
                        if (snapshot) setQuickEdit({ editor, snapshot });
                      }}
                    />
                  </BubbleMenu>}
                  <EditorContent editor={editor} />
                  {quickEdit?.editor === editor && <SelectionQuickEdit key={selectedFile.id} editor={editor} noteId={selectedFile.id} snapshot={quickEdit.snapshot} onClose={() => setQuickEdit(null)} />}
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>

      {!isMobile && headings.length > 1 && !mobileOutlineOpen && (
        <ChapterRail headings={visibleHeadings} groups={headingGroups} activeId={activeId} onHeadingClick={scrollToHeading} />
      )}

      {versionHistoryOpen && (
        <Suspense fallback={<div className="absolute inset-0 z-[55] flex items-center justify-center bg-white/70 text-sm text-jelly-text-muted">正在加载版本历史…</div>}>
          <VersionHistoryPanel
            noteId={selectedFile.id}
            noteTitle={selectedFile.name.replace(/\.md$/i, "")}
            currentContent={rawContent}
            onClose={() => setVersionHistoryOpen(false)}
          />
        </Suspense>
      )}
    </main>
  );
}
