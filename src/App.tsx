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
import WorkspaceFeedback from './components/OperationFeedback';
import "./components/library-navigation.css";
import { useAuthSession } from "./hooks/useAuthSession";
import { useDockedLibraryMotion } from './hooks/useDockedLibraryMotion';
import { resolveWorkspaceLayout } from './utils/workspaceLayout';
import { useChatSelection, useDraftSlice } from "./store/selectors";

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
  const libraryNavigationRef = useRef<HTMLDivElement>(null);
  const librarySurfaceRef = useRef<HTMLDivElement>(null);
  const libraryToggleSlotRef = useRef<HTMLSpanElement>(null);
  const libraryFocusPending = useRef(false);
  const [libraryWidth, setLibraryWidth] = useState(loadLibraryWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [filePanelPinned, setFilePanelPinned] = useState(true);
  const previousFilePanelPinned = useRef(filePanelPinned);
  const [aiOpen, setAiOpen] = useState(false);
  const [panelPriority, setPanelPriority] = useState<'library' | 'ai'>('library');
  const [aiPanelWidth, setAiPanelWidth] = useState(AI_PANEL_DEFAULT_WIDTH);
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadThemeMode);
  const isTabletUp = useMediaQuery("(min-width: 768px)");
  const { centerMode, draftSeed, pendingCheckpoint, activeDraftContext } = useDraftSlice();
  const chatSelection = useChatSelection();
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
  const layout = resolveWorkspaceLayout({ viewportWidth, libraryWidth: libraryWidth ?? 260,
    aiWidth: aiPanelWidth, libraryRequested: filePanelPinned && !focusedWorkspace,
    aiRequested: aiOpen && !focusedWorkspace, priority: panelPriority });
  const libraryVisible = layout.libraryVisible;
  const aiVisible = layout.aiVisible;
  const desktopRightWidth = layout.rightWidth;
  const libraryMaxWidth = isTabletUp ? layout.libraryMaxWidth : 420;
  const effectiveLibraryWidth = isTabletUp ? layout.libraryWidth : libraryWidth ?? 280;
  const { phase: libraryPhase, previewWidth: previewLibraryMotionWidth } = useDockedLibraryMotion({
    navigationRef: libraryNavigationRef, surfaceRef: librarySurfaceRef,
    toggleRef: libraryLauncherRef, toggleSlotRef: libraryToggleSlotRef,
    open: libraryVisible, width: effectiveLibraryWidth,
    enabled: isTabletUp && !focusedWorkspace && !authLoading && Boolean(session),
  });
  const desktopLeftWidth = isTabletUp && !focusedWorkspace
    ? (libraryVisible ? "var(--library-panel-width)" : "0px") : "0px";
  const workspaceLayoutStyle = {
    "--ai-panel-width": `${layout.aiWidth}px`,
    "--library-panel-width": `${effectiveLibraryWidth}px`,
    "--workspace-left-width": desktopLeftWidth,
    "--workspace-right-width": `${desktopRightWidth}px`,
  } as React.CSSProperties;

  const previewLibraryWidth = useCallback((width: number, dragging: boolean) => {
    workspaceRef.current?.style.setProperty("--library-panel-width", `${width}px`);
    previewLibraryMotionWidth(width);
    if (workspaceRef.current) workspaceRef.current.dataset.libraryResizing = String(dragging);
  }, [previewLibraryMotionWidth]);
  const commitLibraryWidth = useCallback((width: number) => {
    if (width === effectiveLibraryWidth) return;
    setLibraryWidth(width);
    try { localStorage.setItem(LIBRARY_WIDTH_KEY, String(width)); } catch {}
  }, [effectiveLibraryWidth]);
  const previewAiWidth = useCallback((width: number, dragging: boolean) => {
    const node = workspaceRef.current;
    if (!node) return;
    const visible = node.querySelector('.ai-navigation[data-open="true"]');
    const preview = resolveWorkspaceLayout({ viewportWidth, libraryWidth: libraryWidth ?? 260,
      aiWidth: width, libraryRequested: filePanelPinned && !focusedWorkspace,
      aiRequested: Boolean(visible), priority: panelPriority });
    node.style.setProperty("--ai-panel-width", `${preview.aiWidth}px`);
    node.style.setProperty("--workspace-right-width", `${preview.rightWidth}px`);
    node.style.setProperty("--library-panel-width", `${preview.libraryWidth}px`);
    previewLibraryMotionWidth(preview.libraryWidth);
    node.dataset.aiResizing = String(dragging);
  }, [libraryWidth, viewportWidth, filePanelPinned, focusedWorkspace, panelPriority, previewLibraryMotionWidth]);
  const commitAiWidth = useCallback((width: number) => {
    if (width !== layout.aiWidth) setAiPanelWidth(width);
  }, [layout.aiWidth]);
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
    if (isTabletUp) setLibraryDrawerOpen(false);
  }, [isTabletUp]);

  useEffect(() => {
    const changed = previousFilePanelPinned.current !== libraryVisible;
    previousFilePanelPinned.current = libraryVisible;
    if (changed) libraryFocusPending.current = panelPriority === 'library';
    if (!isTabletUp || focusedWorkspace) { libraryFocusPending.current = false; return; }
    if (!libraryFocusPending.current || libraryPhase !== (libraryVisible ? 'open' : 'closed')) return;
    libraryFocusPending.current = false;
    const target = libraryLauncherRef.current;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body ||
          document.activeElement === target) {
        target?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [libraryVisible, panelPriority, libraryPhase, isTabletUp, focusedWorkspace]);

  useEffect(() => {
    if (chatSelection) { setPanelPriority('ai'); setAiOpen(true); }
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
            isTabletUp ? "stable-workspace-layout" : ""
          }`}
          style={workspaceLayoutStyle}
        >
          {!focusedWorkspace && (isTabletUp || !libraryDrawerOpen) && (
            <button ref={libraryLauncherRef} type="button"
              className="library-launcher directory-toggle absolute left-3 top-3 z-50 flex h-8 w-8 items-center justify-center text-jelly-text-muted"
              onClick={() => {
                if (isTabletUp) { setPanelPriority('library'); setFilePanelPinned(!libraryVisible); }
                else { setAiOpen(false); setLibraryDrawerOpen(true); }
              }}
              onKeyDown={(event) => {
                if (isTabletUp && libraryVisible && event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                  event.preventDefault(); setFilePanelPinned(false);
                }
              }}
              data-motion={isTabletUp ? libraryPhase : undefined}
              aria-label={isTabletUp ? (libraryVisible ? "收起目录" : "展开目录") : "打开知识库"}
              aria-expanded={isTabletUp ? libraryVisible : libraryDrawerOpen}
              aria-describedby={isTabletUp ? "library-toggle-tooltip" : undefined}
              aria-controls={isTabletUp ? "desktop-library" : undefined}>
              <SidebarToggleIcon />
              {isTabletUp && <span id="library-toggle-tooltip" role="tooltip"
                className="library-toggle-tooltip directory-toggle-tooltip pointer-events-none absolute right-0 top-full z-50 mt-1.5 whitespace-nowrap rounded-md border border-jelly-border bg-white px-2.5 py-1 text-[12px] font-medium text-jelly-text-soft opacity-0 shadow-[0_6px_18px_rgba(30,44,56,0.08)]">
                {libraryVisible ? "收起目录" : "展开目录"}
              </span>}
            </button>
          )}

          {/* Keep one full-width surface alive; the closed state owns zero layout space. */}
          {isTabletUp && !focusedWorkspace && (
            <div
              ref={libraryNavigationRef}
              className="library-navigation relative z-40 shrink-0"
              data-open={libraryVisible}
              data-motion={libraryPhase}
              inert={!libraryVisible}
              aria-hidden={!libraryVisible || undefined}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if ((event.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"], input, textarea, [contenteditable="true"]')) return;
                event.preventDefault(); setFilePanelPinned(false); libraryLauncherRef.current?.focus({ preventScroll: true });
              }}
            >
              <div ref={librarySurfaceRef} id="desktop-library" className="library-navigation-surface h-full">
                <DirectoryTree
                  pinned
                  active={libraryVisible}
                  onPinnedChange={setFilePanelPinned}
                  collapseControlSlot={<span ref={libraryToggleSlotRef} aria-hidden="true"
                    className="library-toggle-slot directory-toggle ml-1 flex h-8 w-8 shrink-0" />}
                  themeMode={themeMode}
                  onThemeModeChange={setThemeMode}
                  userEmail={session.user.email}
                  userEmailVerified={session.user.emailVerified}
                  userName={session.user.displayName}
                  onEmailChanged={updateSession}
                  onSignOut={signOut}
                  searchShortcutEnabled
                />
              </div>
              {libraryVisible && libraryPhase === 'open' && libraryResizeHandle}
            </div>
          )}

          {/* Docked panels and the document share normal flow, including during motion. */}
          <div className="workspace-center-layer relative z-0 flex min-w-0 flex-1">
            <WorkspaceCenter />
            <WorkspaceFeedback />
          </div>

          {/* AI drafts stay mounted while hidden so background outline/progress state is preserved. */}
          {draftAvailable && <AIDraftWorkspace key={draftWorkspaceKey} />}

          {/* Only phone-size screens use a library drawer. */}
          {!isTabletUp && !focusedWorkspace && (
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

          {/* One AI instance survives docking, narrow-window drawers and closing. */}
          {!focusedWorkspace && (
            <LibraryDrawer open={aiVisible} side="right" docked={layout.aiDocked} keepMounted
              onClose={() => setAiOpen(false)}
              resizeHandle={layout.aiDocked && (libraryPhase === 'open' || libraryPhase === 'closed') ?
                <LibraryResizeHandle width={layout.aiWidth} minWidth={320} maxWidth={layout.aiMaxWidth}
                  resizeEdge="left" label="调整 AI 助手宽度" onPreview={previewAiWidth} onCommit={commitAiWidth} /> : undefined}>
                <AIPanel onCollapse={() => setAiOpen(false)} />
            </LibraryDrawer>
          )}

          {!focusedWorkspace && !aiVisible && (
            <button
              type="button"
              className="ai-orb-launcher absolute bottom-5 right-5 z-50 flex h-11 w-11 items-center justify-center rounded-full text-jelly-blue-deep"
              onClick={() => {
                setLibraryDrawerOpen(false);
                setPanelPriority('ai');
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
