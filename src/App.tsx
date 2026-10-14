import { lazy, Suspense, useRef, useCallback, useState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { AppProvider } from "./store";
import DirectoryTree from "./components/DirectoryTree";
import AIDraftWorkspace from "./components/AIDraftWorkspace";
import EditPreviewWorkspace from "./components/EditPreviewWorkspace";
import AIPanel from "./components/AIPanel";
import LoginPage from "./components/LoginPage";
import NoteOpeningStatus from "./components/NoteOpeningStatus";
import LibraryDrawer from "./components/LibraryDrawer";
import LibraryResizeHandle from "./components/LibraryResizeHandle";
import SidebarToggleIcon from "./components/SidebarToggleIcon";
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
  const libraryLauncherRef = useRef<HTMLButtonElement>(null);
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
    ? (filePanelPinned ? "var(--library-panel-width)" : "0px") : "0px";
  const workspaceLayoutStyle = {
    "--ai-panel-width": `${aiPanelWidth}px`,
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
  const previewAiWidth = useCallback((width: number, dragging: boolean) => {
    const node = workspaceRef.current;
    if (!node) return;
    node.style.setProperty("--ai-panel-width", `${width}px`);
    const visible = node.querySelector('.ai-navigation[data-open="true"]');
    node.style.setProperty("--workspace-right-width", `${visible ? width : 0}px`);
    node.style.setProperty("--library-panel-width", `${Math.min(libraryWidth ?? 260, Math.max(220, Math.min(420, viewportWidth - (visible ? width : 0) - 416)))}px`);
    node.dataset.aiResizing = String(dragging);
  }, [libraryWidth, viewportWidth]);
  const commitAiWidth = useCallback((width: number) => setAiPanelWidth(width), []);
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
          {!focusedWorkspace && (isDesktop || !libraryDrawerOpen) && (
            <button ref={libraryLauncherRef} type="button"
              className="library-launcher directory-toggle absolute left-3 top-3 z-50 flex h-8 w-8 items-center justify-center text-jelly-text-muted"
              onClick={() => {
                if (isDesktop) setFilePanelPinned((open) => !open);
                else { setAiOpen(false); setLibraryDrawerOpen(true); }
              }}
              aria-label={isDesktop && filePanelPinned ? "收起目录" : isTabletUp ? "展开目录" : "打开知识库"}
              aria-expanded={isDesktop ? filePanelPinned : libraryDrawerOpen}
              aria-controls={isDesktop ? "desktop-library" : undefined}>
              <SidebarToggleIcon />
            </button>
          )}

          {/* Keep one full-width surface alive; the closed state owns zero layout space. */}
          {isTabletUp && !focusedWorkspace && (
            <div
              className="library-navigation relative z-40 shrink-0"
              data-open={isDesktop && filePanelPinned}
              style={{ width: isDesktop && filePanelPinned ? "var(--library-panel-width)" : 0 }}
              inert={!isDesktop || !filePanelPinned}
              aria-hidden={!isDesktop || !filePanelPinned || undefined}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if ((event.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"], input, textarea, [contenteditable="true"]')) return;
                event.preventDefault(); setFilePanelPinned(false); libraryLauncherRef.current?.focus({ preventScroll: true });
              }}
            >
              <div id="desktop-library" className="library-navigation-surface h-full">
                <DirectoryTree
                  pinned
                  active={isDesktop && filePanelPinned}
                  hideCollapseControl
                  onPinnedChange={setFilePanelPinned}
                  themeMode={themeMode}
                  onThemeModeChange={setThemeMode}
                  userEmail={session.user.email}
                  userEmailVerified={session.user.emailVerified}
                  userName={session.user.displayName}
                  onEmailChanged={updateSession}
                  onSignOut={signOut}
                  searchShortcutEnabled={isDesktop || !libraryDrawerOpen}
                />
              </div>
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
            <div className="ai-navigation relative z-40 ml-auto h-full shrink-0" data-open={aiOpen}>
              {aiOpen && <LibraryResizeHandle width={aiPanelWidth} minWidth={320} maxWidth={680}
                resizeEdge="left" label="调整 AI 助手宽度" onPreview={previewAiWidth} onCommit={commitAiWidth} />}
              <div className="h-full overflow-hidden" inert={!aiOpen} aria-hidden={!aiOpen || undefined}>
                <div className="ai-navigation-content h-full">
                  <AIPanel onCollapse={() => setAiOpen(false)} />
                </div>
              </div>
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
          {!isDesktop && !focusedWorkspace && (
            <LibraryDrawer open={aiOpen} side="right" onClose={() => setAiOpen(false)}>
                <AIPanel onCollapse={() => setAiOpen(false)} />
            </LibraryDrawer>
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
