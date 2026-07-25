import { lazy, Suspense, useRef, useCallback, useState, useEffect } from "react";
import { BookOpen, Sparkles } from "lucide-react";
import { AppProvider } from "./store";
import DirectoryTree from "./components/DirectoryTree";
import AIDraftWorkspace from "./components/AIDraftWorkspace";
import EditPreviewWorkspace from "./components/EditPreviewWorkspace";
import AIPanel from "./components/AIPanel";
import LoginPage from "./components/LoginPage";
import { useAuthSession } from "./hooks/useAuthSession";
import { useChatSlice, useDraftSlice } from "./storeSlices";

const TiptapPilotEditor = lazy(() => import("./components/TiptapPilotEditor"));

const THEME_STORAGE_KEY = "noteflow-theme-mode";

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
        <main className="flex min-w-0 flex-1 items-center justify-center bg-white text-sm text-jelly-text-muted">
          正在打开文档…
        </main>
      )}
    >
      <TiptapPilotEditor />
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
  const [filePanelPinned, setFilePanelPinned] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(350);
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
  const { loading: authLoading, session, signIn, signUp, signOut } = useAuthSession();
  const desktopLeftWidth = isDesktop && !focusedWorkspace
    ? (filePanelPinned ? 260 : 52)
    : 0;
  const desktopRightWidth = isDesktop && !focusedWorkspace && aiOpen
    ? aiPanelWidth
    : 0;
  const workspaceLayoutStyle = {
    "--workspace-left-width": `${desktopLeftWidth}px`,
    "--workspace-right-width": `${desktopRightWidth}px`,
  } as React.CSSProperties;

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
    if (!libraryDrawerOpen && (isDesktop || !aiOpen)) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
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
    return <LoginPage onSignIn={signIn} onSignUp={signUp} />;
  }

  return (
    <AppProvider userId={session.user.id}>
      <div className="h-full bg-jelly-bg p-0">
        <div
          className={`app-frame relative flex h-full min-w-0 overflow-hidden ${
            isDesktop ? "stable-workspace-layout" : ""
          }`}
          style={workspaceLayoutStyle}
        >
          {/* Persistent library navigation: full panel on desktop, icon rail on tablet. */}
          {isTabletUp && !focusedWorkspace && (
            <div
              className={`relative z-40 shrink-0 transition-[width] duration-200 ease-out ${
                isDesktop && filePanelPinned ? "w-[260px]" : "w-[52px]"
              }`}
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
                userName={session.user.displayName}
                onSignOut={signOut}
              />
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
                defaultWidth={350}
                minWidth={300}
                maxWidth={600}
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
          {!isDesktop && !focusedWorkspace && libraryDrawerOpen && (
            <div className="absolute inset-0 z-[70] flex" role="dialog" aria-modal="true" aria-label="知识库">
              <button
                type="button"
                className="drawer-backdrop absolute inset-0"
                onClick={() => setLibraryDrawerOpen(false)}
                aria-label="关闭知识库"
              />
              <div className="drawer-surface relative h-full w-[280px] max-w-[88vw]">
                <DirectoryTree
                  pinned
                  onPinnedChange={(pinned) => {
                    if (!pinned) setLibraryDrawerOpen(false);
                  }}
                  onFileOpen={() => setLibraryDrawerOpen(false)}
                  themeMode={themeMode}
                  onThemeModeChange={setThemeMode}
                  userEmail={session.user.email}
                  userName={session.user.displayName}
                  onSignOut={signOut}
                />
              </div>
            </div>
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
