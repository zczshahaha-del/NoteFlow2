import { lazy, Suspense, useRef, useCallback, useState, useEffect } from "react";
import { BookOpen, Sparkles } from "lucide-react";
import { AppProvider } from "./store";
import DirectoryTree from "./components/DirectoryTree";
import AIDraftWorkspace from "./components/AIDraftWorkspace";
import EditPreviewWorkspace from "./components/EditPreviewWorkspace";
import AIPanel from "./components/AIPanel";
import LoginPage from "./components/LoginPage";
import NoteOpeningStatus from "./components/NoteOpeningStatus";
import LibraryDrawer from "./components/LibraryDrawer";
import LibraryResizeHandle from "./components/LibraryResizeHandle";
import "./components/library-navigation.css";
import { useAuthSession } from "./hooks/useAuthSession";
import { useChatSlice, useDraftSlice } from "./store/selectors";

const NoteEditor = lazy(() => import("./components/NoteEditor"));

const THEME_STORAGE_KEY = "noteflow-theme-mode";
const AI_PANEL_DEFAULT_WIDTH = 500;
const LIBRARY_WIDTH_KEY = "noteflow-library-width";

function loadLibraryWidth(): number | null {
  try {
    const stored = localStorage.getItem(LIBRARY_WIDTH_KEY);
    const value = stored === null ? NaN : Number(stored);
    return Number.isFinite(value) && value >= 220 && value <= 420 ? value : null;
  } catch { return null; }
}

type ThemeMode = "light" | "dark";

function loadThemeMode(): ThemeMode {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function ResizablePanel({
  defaultWidth,
  minWidth = 220,
  maxWidth = 360,
  resizeEdge = "right",
  collapsed,
  onWidthChange,
  children,
}: {
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  resizeEdge?: "left" | "right";
  collapsed: boolean;
  onWidthChange?: (width: number) => void;
  children: React.ReactNode;
}) {
  const [width, setWidth] = useState(defaultWidth);
  const [dragging, setDragging] = useState(false);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const pendingWidth = useRef(width);
  const animationFrame = useRef<number | null>(null);

  useEffect(() => {
    pendingWidth.current = width;
    onWidthChange?.(width);
  }, [onWidthChange, width]);

  const handleMouseDown = useCallback(
    (e: React.PointerEvent) => {
      if (collapsed) return;
      e.preventDefault();
      isDragging.current = true;
      setDragging(true);
      startX.current = e.clientX;
      startWidth.current = width;
      pendingWidth.current = width;

      const commitWidth = () => {
        animationFrame.current = null;
        setWidth(pendingWidth.current);
      };

      const handleMouseMove = (ev: PointerEvent) => {
        if (!isDragging.current) return;
        const delta = ev.clientX - startX.current;
        const signedDelta = resizeEdge === "left" ? -delta : delta;
        pendingWidth.current = Math.min(maxWidth, Math.max(minWidth, startWidth.current + signedDelta));
        if (animationFrame.current === null) {
          animationFrame.current = window.requestAnimationFrame(commitWidth);
        }
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        setDragging(false);
        if (animationFrame.current !== null) {
          window.cancelAnimationFrame(animationFrame.current);
          animationFrame.current = null;
        }
        setWidth(pendingWidth.current);
        document.removeEventListener("pointermove", handleMouseMove);
        document.removeEventListener("pointerup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("pointermove", handleMouseMove);
      document.addEventListener("pointerup", handleMouseUp);
    },
    [width, minWidth, maxWidth, collapsed, resizeEdge]
  );

  useEffect(() => {
    return () => {
      if (animationFrame.current !== null) {
        window.cancelAnimationFrame(animationFrame.current);
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const resizeHandle = !collapsed ? (
    <div
      className="relative z-20 w-0 shrink-0 cursor-col-resize overflow-visible group/resize"
      onPointerDown={handleMouseDown}
      aria-label="拖拽调整面板宽度"
      style={{ touchAction: "none" }}
    >
      <div
        className={`absolute inset-y-0 w-3 ${
          resizeEdge === "left" ? "-left-1.5" : "-right-1.5"
        }`}
      />
      <div className="absolute inset-y-1.5 left-1/2 w-px -translate-x-1/2 rounded-full bg-jelly-blue/35 opacity-0 transition-opacity duration-200 group-hover/resize:opacity-100" />
    </div>
  ) : null;

  return (
    <div
      className={`shrink-0 flex ${
        dragging ? "" : "transition-[width] duration-300 ease-in-out"
      }`}
      style={{ width: collapsed ? 0 : width, willChange: dragging ? "width" : undefined }}
    >
      {resizeEdge === "left" && resizeHandle}
      <div className="flex-1 min-w-0 overflow-hidden">
        {children}
      </div>
      {resizeEdge === "right" && resizeHandle}
    </div>
  );
}

function WorkspaceCenter() {
  const { centerMode } = useDraftSlice();
  if (centerMode === "edit") return <EditPreviewWorkspace />;
  return (
    <Suspense
      fallback={(
        <div className="note-entry" aria-busy="true"><NoteOpeningStatus /></div>
      )}
    >
      <NoteEditor />
    </Suspense>
  );
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

export default function App() {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [libraryWidth, setLibraryWidth] = useState(loadLibraryWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [filePanelPinned, setFilePanelPinned] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(AI_PANEL_DEFAULT_WIDTH);
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadThemeMode);
  const isDesktop = useMediaQuery("(min-width: 1280px)");
  const isTabletUp = useMediaQuery("(min-width: 768px)");
  const wasDesktop = useRef(isDesktop);
  const { centerMode, draftSeed, pendingCheckpoint, activeDraftContext } = useDraftSlice();
  const { chatSelection } = useChatSlice();
  const focusedWorkspace = centerMode === "edit";
  const draftAvailable =
    centerMode === "draft" ||
    pendingCheckpoint?.checkpointType === "draft_workspace" ||
    Boolean(activeDraftContext);
  const checkpointDraftSeed =
    pendingCheckpoint?.checkpointType === "draft_workspace" &&
    typeof pendingCheckpoint.payload?.seed === "string"
      ? pendingCheckpoint.payload.seed.trim()
      : "";
  const draftWorkspaceKey =
    draftSeed.trim() || checkpointDraftSeed || activeDraftContext?.topic || "draft-workspace";
  const { loading: authLoading, session, signIn, signInWithEmailCode, signUp, signOut, updateSession } = useAuthSession();
  const desktopRightWidth = isDesktop && !focusedWorkspace && aiOpen
    ? aiPanelWidth
    : 0;
  const libraryMaxWidth = isDesktop
    ? Math.max(220, Math.min(420, viewportWidth - desktopRightWidth - 416)) : 420;
  const effectiveLibraryWidth = Math.min(libraryWidth ?? (isDesktop ? 260 : 280), libraryMaxWidth);
  const desktopLeftWidth = isDesktop && !focusedWorkspace
    ? (filePanelPinned ? "var(--library-panel-width)" : "52px") : "0px";
  const workspaceLayoutStyle = {
    "--library-panel-width": `${effectiveLibraryWidth}px`,
    "--workspace-left-width": desktopLeftWidth,
    "--workspace-right-width": `${desktopRightWidth}px`,
  } as React.CSSProperties;

  const previewLibraryWidth = useCallback((width: number, dragging: boolean) => {
    workspaceRef.current?.style.setProperty("--library-panel-width", `${width}px`);
    if (workspaceRef.current) workspaceRef.current.dataset.libraryResizing = String(dragging);
  }, []);
  const commitLibraryWidth = useCallback((width: number) => {
    setLibraryWidth(width);
    try { localStorage.setItem(LIBRARY_WIDTH_KEY, String(width)); } catch {}
  }, []);
  useEffect(() => {
    previewLibraryWidth(effectiveLibraryWidth, false);
  }, [effectiveLibraryWidth, isDesktop, filePanelPinned, libraryDrawerOpen, previewLibraryWidth]);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const libraryResizeHandle = isTabletUp ? (
    <LibraryResizeHandle width={effectiveLibraryWidth} maxWidth={libraryMaxWidth}
      onPreview={previewLibraryWidth} onCommit={commitLibraryWidth} />
  ) : null;

  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", themeMode === "dark");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {}
  }, [themeMode]);

  useEffect(() => {
    if (wasDesktop.current && !isDesktop) {
      setAiOpen(false);
    }
    if (isDesktop) {
      setLibraryDrawerOpen(false);
    }
    wasDesktop.current = isDesktop;
  }, [isDesktop]);

  useEffect(() => {
    // The library owns its Escape handling, including nested menus and dialogs.
    if (libraryDrawerOpen || isDesktop || !aiOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const keyEvent = event as KeyboardEvent & { keyCode?: number };
      if (keyEvent.isComposing || keyEvent.keyCode === 229) return;
      setLibraryDrawerOpen(false);
      if (!isDesktop) setAiOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [aiOpen, isDesktop, libraryDrawerOpen]);

  useEffect(() => {
    if (chatSelection) setAiOpen(true);
  }, [chatSelection?.id]);

  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-jelly-bg p-3">
        <div className="panel-surface px-5 py-4 text-[13px] text-jelly-text-soft">
          正在检查登录状态...
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginPage onSignIn={signIn} onEmailCodeSignIn={signInWithEmailCode} onSignUp={signUp} />;
  }

  return (
    <AppProvider userId={session.user.id}>
      <div className="h-full bg-jelly-bg p-0">
        <div
          ref={workspaceRef}
          className={`app-frame relative flex h-full min-w-0 overflow-hidden ${
            isDesktop ? "stable-workspace-layout" : ""
          }`}
          style={workspaceLayoutStyle}
        >
          {/* Persistent library navigation: full panel on desktop, icon rail on tablet. */}
          {isTabletUp && !focusedWorkspace && (
            <div
              className="library-navigation relative z-40 shrink-0"
              style={{ width: isDesktop && filePanelPinned ? "var(--library-panel-width)" : 52 }}
            >
              <DirectoryTree
                pinned={isDesktop ? filePanelPinned : false}
                onPinnedChange={(pinned) => {
                  if (isDesktop) {
                    setFilePanelPinned(pinned);
                  } else if (pinned) {
                    setAiOpen(false);
                    setLibraryDrawerOpen(true);
                  }
                }}
                themeMode={themeMode}
                onThemeModeChange={setThemeMode}
                userEmail={session.user.email}
                userEmailVerified={session.user.emailVerified}
                userName={session.user.displayName}
                onEmailChanged={updateSession}
                onSignOut={signOut}
                searchShortcutEnabled={isDesktop || !libraryDrawerOpen}
              />
              {isDesktop && filePanelPinned && libraryResizeHandle}
            </div>
          )}

          {/* On desktop the document owns the whole viewport. Side panels consume
              the empty gutters first and only move the page when they touch it. */}
          <div
            className={
              isDesktop
                ? "workspace-center-layer absolute inset-0 z-0 flex min-w-0"
                : "workspace-center-layer flex min-w-0 flex-1"
            }
          >
            <WorkspaceCenter />
          </div>

          {/* AI drafts stay mounted while hidden so background outline/progress state is preserved. */}
          {draftAvailable && <AIDraftWorkspace key={draftWorkspaceKey} />}

          {/* Desktop AI panel stays resizable. */}
          {isDesktop && !focusedWorkspace && (
            <div className="relative z-40 ml-auto flex h-full shrink-0">
              <ResizablePanel
                defaultWidth={AI_PANEL_DEFAULT_WIDTH}
                minWidth={320}
                maxWidth={680}
                resizeEdge="left"
                collapsed={!aiOpen}
                onWidthChange={setAiPanelWidth}
              >
                <div
                  className={`h-full transition-opacity duration-200 ${
                    aiOpen ? "opacity-100" : "pointer-events-none opacity-0"
                  }`}
                >
                  <AIPanel onCollapse={() => setAiOpen(false)} />
                </div>
              </ResizablePanel>
            </div>
          )}

          {/* Mobile/tablet library drawer. */}
          {!isDesktop && !focusedWorkspace && (
            <LibraryDrawer open={libraryDrawerOpen} onClose={() => setLibraryDrawerOpen(false)} resizeHandle={libraryResizeHandle}>
                <DirectoryTree
                  pinned
                  onPinnedChange={(pinned) => {
                    if (!pinned) setLibraryDrawerOpen(false);
                  }}
                  onFileOpen={() => setLibraryDrawerOpen(false)}
                  themeMode={themeMode}
                  onThemeModeChange={setThemeMode}
                  userEmail={session.user.email}
                  userEmailVerified={session.user.emailVerified}
                  userName={session.user.displayName}
                  onEmailChanged={updateSession}
                  onSignOut={signOut}
                  searchShortcutEnabled={libraryDrawerOpen}
                />
            </LibraryDrawer>
          )}

          {/* Mobile/tablet AI drawer. */}
          {!isDesktop && !focusedWorkspace && aiOpen && (
            <div className="absolute inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true" aria-label="AI 助手">
              <button
                type="button"
                className="drawer-backdrop absolute inset-0"
                onClick={() => setAiOpen(false)}
                aria-label="关闭 AI 助手"
              />
              <div className="drawer-surface relative h-full w-[400px] max-w-[92vw] border-l border-jelly-border">
                <AIPanel onCollapse={() => setAiOpen(false)} />
              </div>
            </div>
          )}

          {!isTabletUp && !focusedWorkspace && !libraryDrawerOpen && (
            <button
              type="button"
              className="floating-launcher absolute left-3 top-3 z-50 flex h-10 items-center gap-2 px-3 text-[13px] font-medium text-jelly-text-soft"
              onClick={() => {
                setAiOpen(false);
                setLibraryDrawerOpen(true);
              }}
              aria-label="打开知识库"
            >
              <BookOpen size={16} strokeWidth={1.8} />
              <span className="hidden min-[420px]:inline">知识库</span>
            </button>
          )}

          {!focusedWorkspace && !aiOpen && (
            <button
              type="button"
              className="ai-orb-launcher absolute bottom-5 right-5 z-50 flex h-11 w-11 items-center justify-center rounded-full text-jelly-blue-deep"
              onClick={() => {
                setLibraryDrawerOpen(false);
                setAiOpen(true);
              }}
              aria-label="展开 AI 助手"
              title="AI 助手"
            >
              <Sparkles size={20} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>
    </AppProvider>
  );
}
