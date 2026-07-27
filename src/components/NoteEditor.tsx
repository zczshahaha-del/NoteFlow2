import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Calendar,
  Code2,
  FileCode2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  History,
  Italic,
  Link,
  List,
  ListTree,
  ListChecks,
  ListOrdered,
  Menu,
  MessageSquarePlus,
  MoreHorizontal,
  Pilcrow,
  Quote,
  Redo2,
  RefreshCw,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from "lucide-react";
import { useEditorSlice } from "../store/selectors";
import { findFileById } from "../workspaceTree";
import { createNoteFlowTiptapExtensions } from "../editor/tiptapExtensions";
import { findTiptapTextRange } from "../utils/tiptapSelection";
import OutlinePanel from "./OutlinePanel";
import { attachmentMarkdown, uploadAttachment } from "../services/attachments";
import { getNoteOutline, type NoteSectionRecord } from "../services/notes";
import { formatDocumentTime } from "../utils/documentTime";
import { numberHeadings } from "../utils/headingNumbering";

const VersionHistoryPanel = lazy(() => import("./VersionHistoryPanel"));
const extensions = createNoteFlowTiptapExtensions();
const HEADING_NUMBERING_STORAGE_KEY = "noteflow:show-heading-numbers";
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

function loadHeadingNumberingPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(HEADING_NUMBERING_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

interface TiptapHeading {
  id: string;
  level: number;
  text: string;
  position: number;
}

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
  const headings: TiptapHeading[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== "heading") return;
    headings.push({
      id: `tiptap-heading-${position}`,
      level: Number(node.attrs.level) || 1,
      text: node.textContent.trim() || "未命名标题",
      position,
    });
  });
  return headings;
}

function activeHeadingId(editor: Editor, headings: TiptapHeading[]): string {
  const selectionPosition = editor.state.selection.from;
  let active = "";
  headings.forEach((heading) => {
    if (heading.position < selectionPosition) active = heading.id;
  });
  return active;
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

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`document-toolbar-button relative inline-flex h-8 w-8 items-center justify-center transition-colors disabled:opacity-35 ${
        active
          ? "text-jelly-blue-deep after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-jelly-blue-deep"
          : "text-jelly-text-soft hover:text-jelly-text"
      }`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
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

export default function NoteEditor() {
  const {
    selectedFileId,
    treeData,
    fileContents,
    noteSaveState,
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
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [mobileOutlineOpen, setMobileOutlineOpen] = useState(false);
  const [documentMenuOpen, setDocumentMenuOpen] = useState(false);
  const [showHeadingNumbers, setShowHeadingNumbers] = useState(loadHeadingNumberingPreference);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [backendSections, setBackendSections] = useState<NoteSectionRecord[]>([]);
  const documentMenuRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery("(max-width: 767px)");

  const editor = useEditor(
    {
      extensions,
      content: rawContent,
      contentType: "markdown",
      immediatelyRender: true,
      shouldRerenderOnTransaction: true,
      editorProps: {
        attributes: {
          class: "note-content min-h-[56vh] outline-none",
          "data-testid": "tiptap-editor-content",
          "aria-label": "笔记正文",
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        if (!selectedFileId) return;
        updateFileContent(selectedFileId, currentEditor.getMarkdown());
      },
    },
    [selectedFileId]
  );

  useEffect(() => {
    setTitleDraft(selectedFile?.name.replace(/\.md$/i, "") ?? "未命名笔记");
    setVersionHistoryOpen(false);
    setMobileOutlineOpen(false);
    setDocumentMenuOpen(false);
  }, [selectedFile?.id, selectedFile?.name]);

  useEffect(() => {
    if (!documentMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!documentMenuRef.current?.contains(event.target as Node)) {
        setDocumentMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick, true);
  }, [documentMenuOpen]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.getMarkdown() === rawContent) return;
    editor.commands.setContent(rawContent, { contentType: "markdown", emitUpdate: false });
  }, [editor, rawContent]);

  useEffect(() => {
    if (
      !editor ||
      editor.isDestroyed ||
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
  }, [clearPendingEditorSelection, editor, pendingEditorSelection, rawContent, selectedFileId]);

  useEffect(() => {
    if (
      !editor ||
      editor.isDestroyed ||
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
  }, [clearPendingSourceFocus, editor, pendingSourceFocus, rawContent, selectedFileId]);

  const editorReady = Boolean(editor && !editor.isDestroyed);
  const headings = editorReady ? collectHeadings(editor!) : [];
  const numberedHeadings = numberHeadings(headings);
  const visibleHeadings = showHeadingNumbers
    ? numberedHeadings
    : numberedHeadings.map((heading) => ({ ...heading, displayNumber: "" }));
  const activeId = editorReady ? activeHeadingId(editor!, headings) : "";
  const headingPositions = useMemo(
    () => new Map(headings.map((heading) => [heading.id, heading.position])),
    [headings]
  );
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const headingElements = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")
    );
    editor.view.dom.classList.toggle("heading-numbering-enabled", showHeadingNumbers);
    headingElements.forEach((element, index) => {
      const displayNumber = showHeadingNumbers
        ? numberedHeadings[index]?.displayNumber ?? ""
        : "";
      if (displayNumber) element.dataset.headingNumber = displayNumber;
      else delete element.dataset.headingNumber;
    });
  }, [editor, numberedHeadings, showHeadingNumbers]);
  useEffect(() => {
    let alive = true;
    setBackendSections([]);
    setActiveEditorSectionId(null);
    if (!selectedFileId) return;
    void getNoteOutline(selectedFileId)
      .then((outline) => { if (alive) setBackendSections(outline.sections); })
      .catch(() => { if (alive) setBackendSections([]); });
    return () => { alive = false; };
  }, [noteSaveState.status, selectedFile?.indexStatus, selectedFileId, setActiveEditorSectionId]);

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
  const saveLabel =
    noteSaveState.status === "saving"
      ? "保存中"
      : noteSaveState.status === "unsaved"
        ? "未保存"
        : noteSaveState.status === "offline"
          ? "离线已保存"
        : noteSaveState.status === "error"
          ? "保存失败"
          : "已保存";
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
  const createdAtLabel = formatDocumentTime(selectedFile?.createdAt);
  const updatedAtLabel = formatDocumentTime(selectedFile?.updatedAt);

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
        正在打开文档…
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
    for (const file of files) {
      const item = await uploadAttachment(file, selectedFile.id);
      insertAttachmentMarkdown(attachmentMarkdown(item));
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
      activeId={activeId}
      onHeadingClick={scrollToHeading}
      onClose={() => setMobileOutlineOpen(false)}
    />
  );

  return (
    <main className="document-editor document-canvas relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="relative flex min-h-0 flex-1">
        {isMobile && headings.length > 1 && !mobileOutlineOpen && (
          <button
            type="button"
            className="floating-launcher absolute left-3 top-3 z-40 flex h-10 w-10 items-center justify-center text-jelly-text-soft"
            onClick={() => setMobileOutlineOpen(true)}
            aria-label="展开目录"
          >
            <Menu size={18} />
          </button>
        )}
        {mobileOutlineOpen && (
          <div className="absolute inset-0 z-[65] flex justify-end" role="dialog" aria-modal="true" aria-label="本文目录">
            <button type="button" className="drawer-backdrop absolute inset-0" onClick={() => setMobileOutlineOpen(false)} aria-label="关闭本文目录" />
            <aside className="drawer-surface relative h-full w-[340px] max-w-[86vw] border-l border-jelly-border shadow-[-18px_0_46px_rgba(15,23,42,0.08)]">{outline}</aside>
          </div>
        )}

        <section className="flex min-w-0 flex-1 flex-col">
          {false && <div className="document-toolbar flex flex-wrap items-center gap-1 border-b border-jelly-border/70 bg-white px-3 py-1.5" role="toolbar" aria-label="文档格式工具栏">
            <ToolbarButton label="加入对话" onClick={addCurrentSelectionToChat} disabled={editor.state.selection.empty}><MessageSquarePlus size={16} /></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-jelly-border" />
            <ToolbarButton label="正文" active={editor.isActive("paragraph")} onClick={() => editor.chain().focus().setParagraph().run()}><Pilcrow size={16} /></ToolbarButton>
            <ToolbarButton label="标题 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></ToolbarButton>
            <ToolbarButton label="标题 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></ToolbarButton>
            <ToolbarButton label="标题 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={16} /></ToolbarButton>
            <ToolbarButton label="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></ToolbarButton>
            <ToolbarButton label="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></ToolbarButton>
            <ToolbarButton label="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={16} /></ToolbarButton>
            <ToolbarButton label="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></ToolbarButton>
            <ToolbarButton label="高亮" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter size={16} /></ToolbarButton>
            <ToolbarButton label="行内代码" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}><Code2 size={16} /></ToolbarButton>
            <ToolbarButton label="代码块" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><FileCode2 size={16} /></ToolbarButton>
            <ToolbarButton label="链接" active={editor.isActive("link")} onClick={() => {
              if (editor.isActive("link")) editor.chain().focus().unsetLink().run();
              else setLinkOpen((value) => !value);
            }}><Link size={16} /></ToolbarButton>
            <ToolbarButton label="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></ToolbarButton>
            <ToolbarButton label="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></ToolbarButton>
            <ToolbarButton label="任务列表" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={16} /></ToolbarButton>
            <ToolbarButton label="引用" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={16} /></ToolbarButton>
            <ToolbarButton label="插入表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={16} /></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-jelly-border" />
            <ToolbarButton label="撤销" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></ToolbarButton>
            <ToolbarButton label="重做" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></ToolbarButton>
          </div>}

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
            <div className="document-scroll h-full overflow-y-auto px-7 pb-32 pt-20 sm:px-10 xl:px-0">
              <article className="note-page mx-auto max-w-[780px]">
                <input
                  value={titleDraft}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTitleDraft(value);
                    updateNodeName(selectedFile.id, `${value.trim() || "未命名笔记"}.md`);
                  }}
                  onBlur={() => {
                    if (!titleDraft.trim()) setTitleDraft("未命名笔记");
                  }}
                  className="document-title block w-full border-none bg-transparent px-0 py-1 text-[clamp(2.05rem,4vw,2.7rem)] font-bold leading-tight text-jelly-text outline-none"
                  aria-label="文档标题"
                />
                <div className="document-meta-row relative mb-8 mt-4 flex min-h-8 flex-wrap items-center gap-2 text-[13px] text-jelly-text-muted">
                  {createdAtLabel && (
                    <>
                      <span>创建于 {createdAtLabel}</span>
                      {updatedAtLabel && <span>·</span>}
                    </>
                  )}
                  {updatedAtLabel && <span>更新于 {updatedAtLabel}</span>}
                  <div ref={documentMenuRef} className="relative ml-auto">
                    <button
                      type="button"
                      className="document-view-menu-trigger flex h-8 w-8 items-center justify-center rounded-lg text-jelly-text-muted transition-colors hover:bg-[#f1f3f4] hover:text-jelly-text"
                      onClick={() => setDocumentMenuOpen((open) => !open)}
                      aria-label="文档显示设置"
                      aria-haspopup="menu"
                      aria-expanded={documentMenuOpen}
                    >
                      <MoreHorizontal size={17} />
                    </button>
                    {documentMenuOpen && (
                      <div
                        className="document-view-menu absolute right-0 top-full z-40 mt-1.5 w-[210px] rounded-xl border border-jelly-border bg-white p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.12)]"
                        role="menu"
                        aria-label="文档显示设置"
                      >
                        <button
                          type="button"
                          className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[#f4f6f7]"
                          role="menuitemcheckbox"
                          aria-checked={showHeadingNumbers}
                          onClick={() => {
                            const nextValue = !showHeadingNumbers;
                            setShowHeadingNumbers(nextValue);
                            try {
                              window.localStorage.setItem(
                                HEADING_NUMBERING_STORAGE_KEY,
                                String(nextValue)
                              );
                            } catch {
                              // The preference remains active for this session.
                            }
                            setDocumentMenuOpen(false);
                          }}
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] ${
                              showHeadingNumbers
                                ? "border-jelly-blue bg-jelly-blue text-white"
                                : "border-jelly-border bg-white"
                            }`}
                            aria-hidden="true"
                          >
                            {showHeadingNumbers ? "✓" : ""}
                          </span>
                          <span>
                            <span className="block text-[13px] font-medium text-jelly-text">
                              显示章节编号
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-4 text-jelly-text-muted">
                              自动编号一级和二级标题
                            </span>
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div
                  onPasteCapture={(event) => {
                    const files = Array.from(event.clipboardData.files);
                    if (!files.length) return;
                    event.preventDefault();
                    void uploadEditorFiles(files).catch(() => undefined);
                  }}
                  onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
                  onDrop={(event) => {
                    const files = Array.from(event.dataTransfer.files);
                    if (!files.length) return;
                    event.preventDefault();
                    void uploadEditorFiles(files).catch(() => undefined);
                  }}
                >
                  <BubbleMenu
                    editor={editor}
                    pluginKey="noteSelectionToolbar"
                    appendTo={selectionToolbarAppendTo}
                    shouldShow={selectionToolbarShouldShow}
                    options={selectionToolbarOptions}
                    className="selection-toolbar tiptap-selection-toolbar"
                    aria-label="选中文字格式工具栏"
                  >
                    <SelectionToolbarButton label="加入对话" onClick={addCurrentSelectionToChat}>
                      <MessageSquarePlus size={15} />
                    </SelectionToolbarButton>
                    <span className="selection-toolbar-divider" aria-hidden="true" />
                    <SelectionToolbarButton label="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
                      <Bold size={15} />
                    </SelectionToolbarButton>
                    <SelectionToolbarButton label="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
                      <Italic size={15} />
                    </SelectionToolbarButton>
                    <SelectionToolbarButton label="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
                      <UnderlineIcon size={15} />
                    </SelectionToolbarButton>
                    <SelectionToolbarButton label="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
                      <Strikethrough size={15} />
                    </SelectionToolbarButton>
                    <SelectionToolbarButton label="高亮" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>
                      <Highlighter size={15} />
                    </SelectionToolbarButton>
                    <SelectionToolbarButton label="行内代码" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
                      <Code2 size={15} />
                    </SelectionToolbarButton>
                    <SelectionToolbarButton label={editor.isActive("link") ? "取消链接" : "添加链接"} active={editor.isActive("link")} onClick={() => {
                      if (editor.isActive("link")) editor.chain().focus().unsetLink().run();
                      else setLinkOpen(true);
                    }}>
                      <Link size={15} />
                    </SelectionToolbarButton>
                    <span className="selection-toolbar-divider" aria-hidden="true" />
                    <SelectionToolbarButton label="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
                      <List size={15} />
                    </SelectionToolbarButton>
                    <SelectionToolbarButton label="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
                      <ListOrdered size={15} />
                    </SelectionToolbarButton>
                    <SelectionToolbarButton label="引用" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
                      <Quote size={15} />
                    </SelectionToolbarButton>
                    <SelectionToolbarButton label="清除格式" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
                      <RefreshCw size={15} />
                    </SelectionToolbarButton>
                  </BubbleMenu>
                  <EditorContent editor={editor} />
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>

      {!isMobile && headings.length > 1 && !mobileOutlineOpen && (
        <nav className="chapter-rail" aria-label="章节快速导航">
          <button
            type="button"
            className="chapter-rail-toc"
            onClick={() => setMobileOutlineOpen(true)}
            aria-label="打开本文目录"
          >
            <ListTree size={15} strokeWidth={1.8} />
            <span>本文目录</span>
          </button>
          <div className="chapter-rail-track">
            {visibleHeadings.map((heading) => (
              <button
                key={heading.id}
                type="button"
                className={`chapter-rail-item ${activeId === heading.id ? "is-active" : ""}`}
                onClick={() => scrollToHeading(heading.id)}
                title={`${heading.displayNumber ? `${heading.displayNumber} ` : ""}${heading.text}`}
                style={{ paddingLeft: `${Math.min(heading.hierarchyDepth, 3) * 12}px` }}
              >
                <span className="chapter-rail-mark" />
                <span className="chapter-rail-label">
                  {heading.displayNumber ? `${heading.displayNumber} ` : ""}
                  {heading.text}
                </span>
              </button>
            ))}
          </div>
        </nav>
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
