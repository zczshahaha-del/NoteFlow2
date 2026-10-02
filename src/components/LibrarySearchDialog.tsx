import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CompositionEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { FileText, RotateCcw, Search, X } from "lucide-react";
import { searchNotes, type NoteSearchScope } from "../services/notes";
import type { ChatSource, FileNode } from "../types";
import { formatDocumentTime } from "../utils/documentTime";
import "./library-search.css";

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
        className="nf-search-highlight"
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
  const [present, setPresent] = useState(open);
  const [contentHeight, setContentHeight] = useState<number>();
  const composingRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const visible = open || present;

  useEffect(() => {
    if (open) { setPresent(true); return; }
    if (!present) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPresent(false);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), 130);
    return () => window.clearTimeout(timer);
  }, [open, present]);

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
    // Freeze the closing contents; reset only after the visual exit is removed.
    if (visible) return;
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
    setContentHeight(undefined);
  }, [visible]);

  useEffect(() => {
    if (!open) return;
    // A pointer close can cancel IME without dispatching compositionend. On a
    // quick reopen, discard only that unconfirmed draft, not the last query.
    if (composingRef.current) {
      composingRef.current = false;
      setCompositionActive(false);
      setInputValue(settledValue);
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.body.children)
      .filter((node): node is HTMLElement => node instanceof HTMLElement && node !== overlayRef.current)
      .map((node) => ({ node, inert: node.inert }));
    background.forEach(({ node }) => { node.inert = true; });
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
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.closest('[hidden], [inert], [aria-hidden="true"]'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleDialogKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      background.forEach(({ node, inert }) => { node.inert = inert; });
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    };
  }, [open]);

  // Measure only this content, not a fixed large canvas. Flex caps long results to
  // the viewport; the input stays anchored while the body grows downwards.
  useLayoutEffect(() => {
    if (!visible || !open) return;
    const measure = () => {
      const height = bodyRef.current?.getBoundingClientRect().height;
      if (height) setContentHeight(height);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (bodyRef.current) observer?.observe(bodyRef.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [visible, open, groups, inputValue, compositionActive, searchPending, loading, errorText]);

  useEffect(() => {
    const sequence = ++requestSequenceRef.current;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;

    if (!open) return;
    if (compositionActive) {
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

  if (!visible) return null;

  const resultSummary =
    normalizedQuery && resultsAreCurrent && !compositionActive && !loading && !searchPending && !errorText
      ? `${groups.length} 篇笔记 · ${results.length} 处命中`
      : "";

  return createPortal(
    <div ref={overlayRef} className="nf-library-search" data-open={open} inert={!open} aria-hidden={!open || undefined}
      onClickCapture={(event) => { if (!open) { event.preventDefault(); event.stopPropagation(); } }}>
      <button
        type="button"
        className="nf-search-backdrop"
        onClick={onClose}
        aria-label="关闭全库搜索"
      />
      <section
        ref={dialogRef}
        className="nf-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-search-title"
      >
        <h2 id="library-search-title" className="sr-only">搜索全部笔记</h2>

        <div className="nf-search-field">
          <Search size={17} strokeWidth={1.65} aria-hidden="true" />
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(event) => handleInputChange(event.target.value)}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={handleInputKeyDown}
            className="nf-search-input"
            placeholder="搜索标题、章节和正文"
            aria-label="搜索全部笔记"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={groups.length > 0 && !loading && !searchPending && !compositionActive}
            aria-controls={groups.length > 0 ? "library-search-results" : undefined}
            aria-activedescendant={
              activeIndex >= 0 && groups[activeIndex] && !loading && !searchPending && !compositionActive
                ? `library-search-result-${activeIndex}` : undefined
            }
          />
          {inputValue && !compositionActive && (
            <button
              type="button"
              className="nf-search-clear"
              onClick={clearSearch}
            >
              清空
            </button>
          )}
          <button
            type="button"
            className="nf-search-close"
            onClick={onClose}
            aria-label="关闭搜索"
          >
            <X size={15} strokeWidth={1.65} aria-hidden="true" />
          </button>
        </div>

        <div className="nf-search-controls">
          <div className="nf-search-scopes" role="group" aria-label="搜索范围">
            {SEARCH_SCOPES.map((option) => {
              const active = option.value === scope;
              return (
                <button
                  key={option.value}
                  type="button"
                  className="nf-search-scope"
                  onClick={() => setScope(option.value)}
                  aria-pressed={active}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="nf-search-summary" aria-live="polite">
            {resultSummary}
          </p>
        </div>

        <div className="nf-search-viewport" style={{ height: contentHeight }}>
          <div ref={bodyRef} className="nf-search-body">
          {!inputValue.trim() ? (
            <p className="nf-search-hint">
              输入笔记标题、章节名或正文关键词。
            </p>
          ) : compositionActive ? (
            <div className="nf-search-wait" role="status">继续完成输入</div>
          ) : searchPending ? (
            <div className="nf-search-wait" role="status">
              等待输入完成…
            </div>
          ) : loading ? (
            <div className="nf-search-wait" role="status">
              <span className="nf-search-dot" aria-hidden="true" />正在搜索…
            </div>
          ) : errorText ? (
            <div className="nf-search-empty" role="alert">
              <p className="nf-search-empty-title nf-search-error">搜索没有完成</p>
              <p className="nf-search-empty-detail">{errorText}</p>
              <button
                type="button"
                className="nf-search-retry"
                onClick={() => setRetryNonce((value) => value + 1)}
              >
                <RotateCcw size={17} strokeWidth={1.65} aria-hidden="true" />
                重新搜索
              </button>
            </div>
          ) : groups.length === 0 ? (
            <div className="nf-search-empty" role="status">
              <p className="nf-search-empty-title">
                没有找到“{normalizedQuery}”
              </p>
              <p className="nf-search-empty-detail">
                可以缩短关键词，或切换到“全部”查看标题和正文
              </p>
            </div>
          ) : (
            <div id="library-search-results" role="listbox" aria-label="搜索结果">
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
                    className="nf-search-result"
                    onClick={() => selectGroup(group)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="nf-search-file">
                      <FileText size={17} strokeWidth={1.65} aria-hidden="true" />
                    </span>
                    <span className="nf-search-copy">
                      <span className="nf-search-row-heading">
                        <span className="nf-search-title">
                          {highlightTerms(group.noteTitle, normalizedQuery)}
                        </span>
                        <span className="nf-search-labels">{group.labels.join(" · ")}</span>
                      </span>
                      <span className="nf-search-location">
                        {location}{updatedDate && ` · 更新于 ${updatedDate}`}
                      </span>
                      <span className="nf-search-snippet">
                        {highlightTerms(groupSnippet(group), normalizedQuery)}
                      </span>
                      {group.matches.length > 1 && (
                        <span className="nf-search-more">
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
        </div>
        <div className="nf-search-footer"><span>↑ ↓ 选择 · Enter 打开</span><span>Esc 关闭</span></div>
      </section>
    </div>,
    document.body
  );
}
