import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CompositionEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { FileText, Loader2, RotateCcw, Search, X } from "lucide-react";
import { searchNotes, type NoteSearchScope } from "../services/notes";
import type { ChatSource, FileNode } from "../types";
import { formatDocumentTime } from "../utils/documentTime";

const SEARCH_DEBOUNCE_MS = 340;

type SearchFunction = typeof searchNotes;

type NoteMetadata = {
  path: string;
  updatedAt: string | null;
};

type SearchResultGroup = {
  noteId: string;
  noteTitle: string;
  matches: ChatSource[];
  primary: ChatSource;
  path: string;
  updatedAt: string | null;
  labels: string[];
};

type LibrarySearchDialogProps = {
  open: boolean;
  treeData: FileNode[];
  onClose: () => void;
  onSelect: (source: ChatSource) => void;
  searchNotesFn?: SearchFunction;
};

const SEARCH_SCOPES: Array<{ value: NoteSearchScope; label: string }> = [
  { value: "all", label: "全部" },
  { value: "title", label: "标题" },
  { value: "content", label: "正文" },
];

function collectNoteMetadata(
  nodes: FileNode[],
  parents: string[] = [],
  result = new Map<string, NoteMetadata>()
): Map<string, NoteMetadata> {
  nodes.forEach((node) => {
    if (node.type === "file") {
      result.set(node.id, {
        path: parents.join(" / ") || "知识库",
        updatedAt: node.updatedAt ?? node.createdAt ?? null,
      });
      return;
    }
    collectNoteMetadata(node.children ?? [], [...parents, node.name], result);
  });
  return result;
}

function sourceHasChannel(source: ChatSource, channel: "heading" | "content"): boolean {
  return (
    (source.retrievalChannels ?? []).includes(channel) ||
    source.sourceType.includes(channel)
  );
}

function groupSearchResults(
  results: ChatSource[],
  metadata: Map<string, NoteMetadata>
): SearchResultGroup[] {
  const grouped = new Map<string, ChatSource[]>();
  const order: string[] = [];

  results.forEach((source) => {
    const matches = grouped.get(source.noteId);
    if (matches) {
      matches.push(source);
      return;
    }
    grouped.set(source.noteId, [source]);
    order.push(source.noteId);
  });

  return order.map((noteId) => {
    const matches = grouped.get(noteId) ?? [];
    const primary = matches[0];
    const labels = [
      matches.some((source) => sourceHasChannel(source, "heading")) ? "标题" : "",
      matches.some((source) => sourceHasChannel(source, "content")) ? "正文" : "",
    ].filter(Boolean);
    const noteMetadata = metadata.get(noteId);
    return {
      noteId,
      noteTitle: primary?.noteTitle ?? "未命名笔记",
      matches,
      primary,
      path: noteMetadata?.path ?? "知识库",
      updatedAt: noteMetadata?.updatedAt ?? null,
      labels,
    };
  }).filter((group) => Boolean(group.primary));
}

function highlightTerms(text: string, query: string) {
  const terms = Array.from(
    new Set(
      query
        .trim()
        .split(/[\s,，.。:：;；!?！？/\\|()[\]{}<>《》"'`]+/)
        .map((term) => term.trim())
        .filter(Boolean)
    )
  )
    .sort((left, right) => right.length - left.length)
    .slice(0, 8);
  if (!text || terms.length === 0) return text;

  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const normalizedTerms = new Set(terms.map((term) => term.toLocaleLowerCase()));

  return text.split(pattern).map((part, index) =>
    normalizedTerms.has(part.toLocaleLowerCase()) ? (
      <mark
        key={`${part}-${index}`}
        className="rounded-sm bg-jelly-amber-bg px-0.5 text-inherit"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function groupSnippet(group: SearchResultGroup): string {
  const contentMatch =
    group.matches.find((source) => source.sectionId && sourceHasChannel(source, "content")) ??
    group.matches.find((source) => sourceHasChannel(source, "content"));
  if (contentMatch?.snippet) return contentMatch.snippet;
  if (group.primary.sectionTitle) return `章节标题：${group.primary.sectionTitle}`;
  return "笔记标题中包含这个关键词";
}

export default function LibrarySearchDialog({
  open,
  treeData,
  onClose,
  onSelect,
  searchNotesFn = searchNotes,
}: LibrarySearchDialogProps) {
  const [inputValue, setInputValue] = useState("");
  const [settledValue, setSettledValue] = useState("");
  const [scope, setScope] = useState<NoteSearchScope>("all");
  const [results, setResults] = useState<ChatSource[]>([]);
  const [resultKey, setResultKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const [compositionActive, setCompositionActive] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const composingRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const noteMetadata = useMemo(() => collectNoteMetadata(treeData), [treeData]);
  const normalizedQuery = settledValue.trim();
  const currentResultKey = `${scope}\u0000${normalizedQuery}`;
  const resultsAreCurrent = resultKey === currentResultKey;
  const groups = useMemo(
    () => groupSearchResults(resultsAreCurrent ? results : [], noteMetadata),
    [noteMetadata, results, resultsAreCurrent]
  );

  useEffect(() => {
    setActiveIndex(groups.length > 0 ? 0 : -1);
  }, [groups]);

  useEffect(() => {
    if (!open) {
      composingRef.current = false;
      setCompositionActive(false);
      setInputValue("");
      setSettledValue("");
      setScope("all");
      setResults([]);
      setResultKey("");
      setLoading(false);
      setSearchPending(false);
      setErrorText("");
      setActiveIndex(-1);
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const keyEvent = event as KeyboardEvent & { keyCode?: number };
        if (
          composingRef.current ||
          keyEvent.isComposing ||
          keyEvent.keyCode === 229
        ) {
          return;
        }
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hidden);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleDialogKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      const previousFocus = previousFocusRef.current;
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    const sequence = ++requestSequenceRef.current;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;

    if (!open || compositionActive) {
      setLoading(false);
      setSearchPending(false);
      return;
    }

    if (!normalizedQuery) {
      setResults([]);
      setResultKey("");
      setLoading(false);
      setSearchPending(false);
      setErrorText("");
      return;
    }

    const controller = new AbortController();
    setResults([]);
    setResultKey("");
    setErrorText("");
    setLoading(false);
    setSearchPending(true);

    const timer = window.setTimeout(() => {
      if (sequence !== requestSequenceRef.current || controller.signal.aborted) return;
      activeControllerRef.current = controller;
      setSearchPending(false);
      setLoading(true);

      void searchNotesFn(normalizedQuery, {
        limit: 20,
        signal: controller.signal,
        mode: "literal",
        scope,
      })
        .then((response) => {
          if (sequence !== requestSequenceRef.current || controller.signal.aborted) return;
          setResults(Array.isArray(response.results) ? response.results : []);
          setResultKey(currentResultKey);
        })
        .catch((error) => {
          if (
            sequence !== requestSequenceRef.current ||
            controller.signal.aborted ||
            (error as { name?: string } | null)?.name === "AbortError"
          ) {
            return;
          }
          setResults([]);
          setResultKey("");
          setErrorText(error instanceof Error ? error.message : "搜索失败，请稍后重试");
        })
        .finally(() => {
          if (
            sequence === requestSequenceRef.current &&
            activeControllerRef.current === controller
          ) {
            activeControllerRef.current = null;
            setLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
    };
  }, [
    compositionActive,
    currentResultKey,
    normalizedQuery,
    open,
    retryNonce,
    scope,
    searchNotesFn,
  ]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const resultElement = document.getElementById(
      `library-search-result-${activeIndex}`
    );
    if (typeof resultElement?.scrollIntoView === "function") {
      resultElement.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
    setCompositionActive(true);
  }, []);

  const handleCompositionEnd = useCallback((event: CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    setCompositionActive(false);
    setInputValue(event.currentTarget.value);
    setSettledValue(event.currentTarget.value);
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    if (!composingRef.current) setSettledValue(value);
  }, []);

  const selectGroup = useCallback(
    (group: SearchResultGroup) => {
      onSelect(group.primary);
      onClose();
    },
    [onClose, onSelect]
  );

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      const nativeEvent = event.nativeEvent as KeyboardEvent & { keyCode?: number };
      if (
        composingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229
      ) {
        if (event.key === "Escape") event.stopPropagation();
        return;
      }
      if (event.key === "ArrowDown" && groups.length > 0) {
        event.preventDefault();
        setActiveIndex((current) => Math.min(groups.length - 1, Math.max(0, current + 1)));
      } else if (event.key === "ArrowUp" && groups.length > 0) {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "Enter" && activeIndex >= 0 && groups[activeIndex]) {
        event.preventDefault();
        selectGroup(groups[activeIndex]);
      }
    },
    [activeIndex, groups, selectGroup]
  );

  const clearSearch = useCallback(() => {
    composingRef.current = false;
    setCompositionActive(false);
    setInputValue("");
    setSettledValue("");
    setResults([]);
    setResultKey("");
    setErrorText("");
    inputRef.current?.focus();
  }, []);

  if (!open) return null;

  const resultSummary =
    normalizedQuery && !compositionActive && !loading && !searchPending && !errorText
      ? `${groups.length} 篇笔记 · ${resultsAreCurrent ? results.length : 0} 处命中`
      : "";

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 max-sm:p-0">
      <button
        type="button"
        className="absolute inset-0 bg-[#17232c]/28 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="关闭全库搜索"
      />
      <section
        ref={dialogRef}
        className="panel-surface relative z-10 flex h-[min(680px,calc(100dvh-32px))] w-[min(800px,calc(100vw-32px))] flex-col overflow-hidden rounded-[14px] border-jelly-border bg-white shadow-[0_28px_90px_rgba(16,30,40,0.2)] max-sm:h-[100dvh] max-sm:w-screen max-sm:rounded-none max-sm:border-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-search-title"
      >
        <h2 id="library-search-title" className="sr-only">搜索全部笔记</h2>

        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-jelly-border px-5 max-sm:px-4">
          <Search size={21} className="shrink-0 text-jelly-blue-deep" strokeWidth={1.9} />
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(event) => handleInputChange(event.target.value)}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={handleInputKeyDown}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-jelly-text outline-none placeholder:text-jelly-text-muted"
            placeholder="搜索标题、章节和正文"
            aria-label="搜索全部笔记"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="library-search-results"
            aria-activedescendant={
              activeIndex >= 0 ? `library-search-result-${activeIndex}` : undefined
            }
          />
          {compositionActive && (
            <span className="shrink-0 text-[11px] text-jelly-text-muted">正在输入…</span>
          )}
          {inputValue && !compositionActive && (
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-[12px] text-jelly-text-muted transition-colors hover:bg-jelly-blue-pale hover:text-jelly-blue-deep focus-visible:bg-jelly-blue-pale focus-visible:text-jelly-blue-deep"
              onClick={clearSearch}
            >
              清空
            </button>
          )}
          <span className="h-6 w-px shrink-0 bg-jelly-border" aria-hidden="true" />
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-jelly-text-muted transition-colors hover:bg-jelly-blue-pale hover:text-jelly-blue-deep focus-visible:bg-jelly-blue-pale focus-visible:text-jelly-blue-deep"
            onClick={onClose}
            aria-label="关闭搜索"
          >
            <X size={19} strokeWidth={1.9} />
          </button>
        </div>

        <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-jelly-border bg-jelly-surface/55 px-5 py-2.5 max-sm:px-4">
          <div className="flex items-center rounded-lg border border-jelly-border bg-white p-0.5">
            {SEARCH_SCOPES.map((option) => {
              const active = option.value === scope;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`h-8 rounded-md px-3 text-[12px] font-medium transition-colors ${
                    active
                      ? "bg-jelly-blue-pale text-jelly-blue-deep"
                      : "text-jelly-text-muted hover:text-jelly-blue-deep focus-visible:text-jelly-blue-deep"
                  }`}
                  onClick={() => setScope(option.value)}
                  aria-pressed={active}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="truncate text-right text-[11px] text-jelly-text-muted" aria-live="polite">
            {compositionActive
              ? "确认文字后开始搜索"
              : loading
                ? "正在搜索…"
                : searchPending
                  ? "等待输入完成"
                  : resultSummary}
          </p>
        </div>

        <div
          id="library-search-results"
          className="min-h-0 flex-1 overflow-y-auto"
          role="listbox"
          aria-label="搜索结果"
        >
          {!inputValue.trim() ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-jelly-blue-pale text-jelly-blue-deep">
                <Search size={21} strokeWidth={1.7} />
              </div>
              <p className="mt-4 text-[15px] font-semibold text-jelly-text">搜索全部笔记</p>
              <p className="mt-1.5 max-w-sm text-[12px] leading-5 text-jelly-text-muted">
                输入笔记标题、章节名或正文关键词。搜索只显示真实文字命中，不会混入无关的语义结果。
              </p>
              <p className="mt-4 text-[11px] text-jelly-text-muted">
                使用 ↑ ↓ 选择结果，按 Enter 打开
              </p>
            </div>
          ) : compositionActive ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center">
              <p className="text-[13px] font-medium text-jelly-text-soft">继续完成输入</p>
              <p className="mt-1 text-[12px] text-jelly-text-muted">文字确认后才会开始防抖搜索</p>
            </div>
          ) : searchPending ? (
            <div className="flex h-full min-h-72 items-center justify-center text-[12px] text-jelly-text-muted">
              等待输入完成…
            </div>
          ) : loading ? (
            <div className="divide-y divide-jelly-border/70 px-5 max-sm:px-4" aria-label="正在加载搜索结果">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="flex animate-pulse gap-3 py-4">
                  <div className="h-9 w-9 shrink-0 rounded-lg bg-jelly-blue-pale" />
                  <div className="min-w-0 flex-1">
                    <div className="h-3.5 w-2/5 rounded bg-jelly-border" />
                    <div className="mt-2 h-3 w-3/5 rounded bg-jelly-border/70" />
                    <div className="mt-2 h-3 w-4/5 rounded bg-jelly-border/60" />
                  </div>
                </div>
              ))}
            </div>
          ) : errorText ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center" role="alert">
              <p className="text-[13px] font-medium text-jelly-red">搜索没有完成</p>
              <p className="mt-1 max-w-md text-[12px] leading-5 text-jelly-text-muted">{errorText}</p>
              <button
                type="button"
                className="mt-4 flex h-8 items-center gap-1.5 rounded-md border border-jelly-border bg-white px-3 text-[12px] font-medium text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
                onClick={() => setRetryNonce((value) => value + 1)}
              >
                <RotateCcw size={13} strokeWidth={1.8} />
                重新搜索
              </button>
            </div>
          ) : groups.length === 0 ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center">
              <p className="text-[14px] font-medium text-jelly-text-soft">
                没有找到“{normalizedQuery}”
              </p>
              <p className="mt-1.5 text-[12px] text-jelly-text-muted">
                可以缩短关键词，或切换到“全部”查看标题和正文
              </p>
            </div>
          ) : (
            <div className="divide-y divide-jelly-border/70 px-3 py-1 max-sm:px-2">
              {groups.map((group, index) => {
                const active = index === activeIndex;
                const updatedDate = formatDocumentTime(group.updatedAt).split(" ")[0];
                const location = [
                  group.path,
                  group.primary.sectionTitle ?? "",
                ].filter(Boolean).join(" / ");
                return (
                  <button
                    id={`library-search-result-${index}`}
                    key={group.noteId}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`group flex w-full gap-3 rounded-lg px-3.5 py-3.5 text-left transition-colors ${
                      active
                        ? "bg-jelly-blue-pale/75"
                        : "hover:bg-jelly-blue-pale/45 focus-visible:bg-jelly-blue-pale/60"
                    }`}
                    onClick={() => selectGroup(group)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-jelly-border bg-white text-jelly-text-muted transition-colors group-hover:text-jelly-blue-deep">
                      <FileText size={17} strokeWidth={1.7} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-start justify-between gap-3">
                        <span className="min-w-0 truncate text-[14px] font-semibold text-jelly-text">
                          {highlightTerms(group.noteTitle, normalizedQuery)}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {group.labels.map((label) => (
                            <span
                              key={label}
                              className="rounded-full border border-jelly-blue/15 bg-white/80 px-2 py-0.5 text-[10px] font-medium text-jelly-blue-deep"
                            >
                              {label}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-jelly-text-muted">
                        <span className="truncate">{location}</span>
                        {updatedDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0">更新于 {updatedDate}</span>
                          </>
                        )}
                      </span>
                      <span className="mt-1.5 line-clamp-2 block text-[12px] leading-5 text-jelly-text-soft">
                        {highlightTerms(groupSnippet(group), normalizedQuery)}
                      </span>
                      {group.matches.length > 1 && (
                        <span className="mt-1 block text-[10px] text-jelly-text-muted">
                          另有 {group.matches.length - 1} 处命中
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}
