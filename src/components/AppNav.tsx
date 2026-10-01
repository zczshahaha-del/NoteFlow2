import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  ArrowUpRight,
  Database,
  FileText,
  RotateCcw,
  Sparkles,
  SunMoon,
  FileArchive,
  FileJson,
  LogOut,
  MailCheck,
  MonitorSmartphone,
  Pencil,
  Settings,
  Trash,
  Trash2,
  UserRound,
  Upload,
  X,
} from "lucide-react";
import { generateId } from "../store";
import { useWorkspaceSlice } from "../store/selectors";
import {
  deleteMemory,
  isMemoryEnabled,
  loadMemorySettings,
  listMemories,
  setMemoryEnabled,
  updateMemory,
  type UserMemoryRecord,
} from "../services/memories";
import {
  createKnowledgeZipBlob,
  createKnowledgeJsonBlob,
  downloadBlob,
  makeKnowledgeBackupName,
  makeKnowledgeJsonName,
} from "../utils/exportKnowledgeZip";
import { parseKnowledgeImport } from "../utils/importKnowledge";
import {
  confirmEmailChange,
  listUserSessions,
  requestEmailChange,
  revokeUserSession,
  type AuthSession,
  type UserSessionRecord,
} from "../services/auth";
import OverlayDialog, { useSurfacePresence } from "./OverlayDialog";

export type AppView = "knowledge";
type ThemeMode = "light" | "dark";

export interface AccountMenuProps {
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  userEmail: string;
  userEmailVerified?: boolean;
  userName?: string;
  onEmailChanged?: (session: AuthSession) => void;
  onSignOut: () => void | Promise<void>;
  compact?: boolean;
  trashCount?: number;
}

function memoryTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    episode: "历史事件",
    identity: "身份称呼",
    personal_info: "个人信息",
    interest: "兴趣爱好",
    preference: "偏好",
    goal: "目标",
    writing_style: "写作风格",
    project: "项目背景",
    skill: "技能方向",
    constraint: "限制",
    workflow: "工作流",
  };
  return labels[type] ?? "记忆";
}

function memoryLayerLabel(layer: string): string {
  const labels: Record<string, string> = {
    semantic: "用户画像",
    episodic: "历史经历",
    working: "任务状态",
    short_term: "短期上下文",
    instant: "当前上下文",
  };
  return labels[layer] ?? "记忆层";
}

function groupMemories(memories: UserMemoryRecord[]) {
  const groups = new Map<string, UserMemoryRecord[]>();
  const visible = memories.filter((memory) => memory.status !== "deleted");
  const pending = visible.filter((memory) => memory.status === "pending");
  const settled = visible.filter((memory) => memory.status !== "pending");
  if (pending.length) {
    groups.set("待确认候选", pending);
  }
  settled.forEach((memory) => {
    const label = memoryTypeLabel(memory.memoryType);
    groups.set(label, [...(groups.get(label) ?? []), memory]);
  });
  return Array.from(groups.entries());
}

function sessionDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return "未知设备";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "浏览器";
  const system = /Mac OS X/.test(userAgent)
    ? "macOS"
    : /Windows/.test(userAgent)
      ? "Windows"
      : /Android/.test(userAgent)
        ? "Android"
        : /iPhone|iPad/.test(userAgent)
          ? "iOS"
          : "设备";
  return `${browser} · ${system}`;
}

export default function AccountMenu({
  themeMode,
  onThemeModeChange,
  userEmail,
  userEmailVerified = false,
  userName,
  onEmailChanged,
  onSignOut,
  compact = false,
  trashCount = 0,
}: AccountMenuProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"account" | "appearance" | "memory" | "data" | "trash">("account");
  const accountPresent = useSurfacePresence(accountOpen);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryEnabledState, setMemoryEnabledState] = useState(isMemoryEnabled);
  const [memorySettingLoading, setMemorySettingLoading] = useState(false);
  const [memories, setMemories] = useState<UserMemoryRecord[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessions, setSessions] = useState<UserSessionRecord[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState(userEmail);
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountPanelRef = useRef<HTMLDivElement>(null);
  const accountPanelId = useId();
  const importInputRef = useRef<HTMLInputElement>(null);
  const accountPrimary = (userName?.trim() && !userName.includes("@") ? userName.trim() : userEmail.split("@")[0]) || "NoteFlow";
  const avatarText = Array.from(accountPrimary)[0].toLocaleUpperCase();
  const avatar = /\p{L}/u.test(avatarText) ? avatarText : <UserRound size={17} strokeWidth={1.6} aria-hidden="true" />;
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const { treeData, fileContents, addNode, setSelectedFileId, deletedNotes, restoreDeletedNote } = useWorkspaceSlice();
  const isDark = themeMode === "dark";

  useEffect(() => {
    if (settingsScrollRef.current) settingsScrollRef.current.scrollTop = 0;
  }, [settingsTab, settingsOpen]);

  useEffect(() => {
    if (!accountOpen) return;

    accountPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });

    const handleOutsideInteraction = (event: Event) => {
      // Browser activation can focus the page itself without navigating away from the disclosure.
      if (event.type === "focusin" && (event.target === document.body || event.target === document.documentElement)) return;
      if (!accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        setAccountOpen(false);
        accountButtonRef.current?.focus({ preventScroll: true });
      }
    };

    document.addEventListener("pointerdown", handleOutsideInteraction);
    document.addEventListener("focusin", handleOutsideInteraction);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideInteraction);
      document.removeEventListener("focusin", handleOutsideInteraction);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountOpen]);

  useEffect(() => {
    if (!emailOpen) setEmailDraft(userEmail);
  }, [emailOpen, userEmail]);

  useEffect(() => {
    let cancelled = false;
    setMemorySettingLoading(true);
    loadMemorySettings()
      .then((settings) => {
        if (!cancelled) setMemoryEnabledState(settings.memoryEnabled);
      })
      .catch(() => {
        if (!cancelled) setMemoryEnabledState(isMemoryEnabled());
      })
      .finally(() => {
        if (!cancelled) setMemorySettingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleExportKnowledgeBase = () => {
    const blob = createKnowledgeZipBlob(treeData, fileContents);
    downloadBlob(blob, makeKnowledgeBackupName());
  };

  const handleExportKnowledgeJson = () => {
    downloadBlob(createKnowledgeJsonBlob(treeData, fileContents), makeKnowledgeJsonName());
  };

  const handleImportKnowledge = async (files: FileList | null) => {
    if (!files?.length) return;
    setImportStatus("正在解析导入文件…");
    try {
      const records = (await Promise.all(Array.from(files).map(parseKnowledgeImport))).flat();
      let lastId: string | null = null;
      records.forEach((record) => {
        const id = generateId();
        lastId = id;
        addNode(null, {
          id,
          name: `${record.title}.md`,
          type: "file",
          content: record.content,
          tags: record.tags,
          summary: `从 ${record.sourcePath} 导入`,
        });
      });
      if (lastId) setSelectedFileId(lastId);
      setImportStatus(`已导入 ${records.length} 篇笔记`);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const reloadMemories = async () => {
    setMemoryLoading(true);
    setMemoryError("");
    try {
      setMemories(await listMemories(false));
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "记忆加载失败");
    } finally {
      setMemoryLoading(false);
    }
  };

  useEffect(() => {
    if (settingsOpen && settingsTab === "memory" && memoryOpen) {
      void reloadMemories();
    }
  }, [settingsOpen, settingsTab, memoryOpen]);

  const reloadSessions = async () => {
    setSessionLoading(true);
    setSessionError("");
    try {
      setSessions(await listUserSessions());
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "登录设备加载失败");
    } finally {
      setSessionLoading(false);
    }
  };

  useEffect(() => {
    if (settingsOpen && settingsTab === "account" && sessionsOpen) void reloadSessions();
  }, [settingsOpen, settingsTab, sessionsOpen]);

  const handleRevokeSession = async (session: UserSessionRecord) => {
    setSessionError("");
    try {
      const currentRevoked = await revokeUserSession(session.id);
      if (currentRevoked) {
        await onSignOut();
        return;
      }
      setSessions((items) => items.filter((item) => item.id !== session.id));
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "退出设备失败");
    }
  };

  const handleRequestEmailCode = async () => {
    setEmailError("");
    setEmailMessage("");
    setEmailLoading(true);
    try {
      const result = await requestEmailChange(emailDraft.trim());
      setEmailCodeSent(true);
      setEmailMessage(result.message);
      if (result.developmentCode) {
        setEmailCode(result.developmentCode);
        setEmailMessage("开发环境验证码已自动填入。");
      }
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "验证码发送失败");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleConfirmEmail = async () => {
    setEmailError("");
    setEmailMessage("");
    setEmailLoading(true);
    try {
      const nextSession = await confirmEmailChange(emailDraft.trim(), emailCode.trim());
      onEmailChanged?.(nextSession);
      setEmailCodeSent(false);
      setEmailCode("");
      setEmailOpen(false);
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "邮箱验证失败");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleMemoryEnabledChange = async () => {
    const next = !memoryEnabledState;
    setMemoryEnabledState(next);
    setMemoryError("");
    setMemorySettingLoading(true);
    try {
      const settings = await setMemoryEnabled(next);
      setMemoryEnabledState(settings.memoryEnabled);
    } catch (error) {
      setMemoryEnabledState(!next);
      setMemoryError(error instanceof Error ? error.message : "记忆设置保存失败");
    } finally {
      setMemorySettingLoading(false);
    }
  };

  const startEditMemory = (memory: UserMemoryRecord) => {
    setEditingMemoryId(memory.id);
    setEditingContent(memory.content);
  };

  const saveEditMemory = async (memory: UserMemoryRecord) => {
    const content = editingContent.trim();
    if (!content) return;
    setMemoryError("");
    try {
      const updated = await updateMemory(memory.id, {
        content,
        reason: "profile_memory_edit",
      });
      setMemories((current) => current.map((item) => (item.id === memory.id ? updated : item)));
      setEditingMemoryId(null);
      setEditingContent("");
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "记忆保存失败");
    }
  };

  const toggleMemoryStatus = async (memory: UserMemoryRecord) => {
    const nextStatus = memory.status === "active" ? "archived" : "active";
    setMemoryError("");
    try {
      const updated = await updateMemory(memory.id, {
        status: nextStatus,
        reason:
          memory.status === "pending"
            ? "profile_memory_approve"
            : nextStatus === "active"
              ? "profile_memory_restore"
              : "profile_memory_archive",
      });
      setMemories((current) => current.map((item) => (item.id === memory.id ? updated : item)));
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "记忆状态更新失败");
    }
  };

  const removeMemory = async (memory: UserMemoryRecord) => {
    setMemoryError("");
    try {
      await deleteMemory(memory.id);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      if (editingMemoryId === memory.id) {
        setEditingMemoryId(null);
        setEditingContent("");
      }
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "记忆删除失败");
    }
  };

  const activeMemoryCount = memories.filter((memory) => memory.status === "active").length;
  const pendingMemoryCount = memories.filter((memory) => memory.status === "pending").length;
  const openSettings = (tab: typeof settingsTab) => {
    // Capture a stable return target before the menu disappears.
    accountButtonRef.current?.focus({ preventScroll: true });
    setAccountOpen(false);
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  const settingsLabel = { account: "账号与安全", appearance: "外观", memory: "AI 与记忆", data: "数据管理", trash: "回收站" }[settingsTab];

  return (
    <div ref={accountRef} data-compact={compact} data-theme={themeMode} className="nf-settings-system account-menu-root relative shrink-0 overflow-visible w-full">
      <button ref={accountButtonRef} type="button" className="nf-account-trigger"
        onClick={() => setAccountOpen((open) => !open)}
        aria-label={accountPrimary + "的账号菜单"} aria-expanded={accountOpen}
        aria-controls={accountPresent ? accountPanelId : undefined} aria-haspopup="dialog" title={accountPrimary}>
        <span className="nf-avatar" aria-hidden="true">{avatar}</span>
        {!compact && <span className="nf-username">{accountPrimary}</span>}
      </button>

      {accountPresent && (
        <div ref={accountPanelRef} id={accountPanelId} role="dialog" aria-label="账号操作"
          className="nf-account-popover" data-open={accountOpen} inert={!accountOpen} aria-hidden={!accountOpen || undefined}>
          <div className="nf-account-heading"><span className="nf-avatar" aria-hidden="true">{avatar}</span><span className="nf-username" title={accountPrimary}>{accountPrimary}</span></div>
          <button type="button" className="nf-menu-item" onClick={() => openSettings("account")}><Settings size={17} strokeWidth={1.6} />设置</button>
          <button type="button" className="nf-menu-item" onClick={() => openSettings("trash")}><Trash size={17} strokeWidth={1.6} />回收站{trashCount > 0 && <span className="nf-row-end ml-auto">{trashCount}</span>}</button>
          <div className="nf-divider" />
          <button type="button" className="nf-menu-item" onClick={() => { setAccountOpen(false); void onSignOut(); }}><LogOut size={17} strokeWidth={1.6} />退出登录</button>
        </div>
      )}

      <OverlayDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} label="设置" themeMode={themeMode} className="nf-settings-dialog">
        <aside className="nf-settings-navigation">
          <p className="nf-brand">设置</p>
          <nav aria-label="设置分类">
            {([
              ["account", "账号与安全", UserRound], ["appearance", "外观", SunMoon],
              ["memory", "AI 与记忆", Sparkles], ["data", "数据管理", Database],
            ] as const).map(([tab, label, Icon]) => (
              <button key={tab} type="button" className="nf-nav" aria-current={(settingsTab === "trash" ? "data" : settingsTab) === tab ? "page" : undefined}
                onClick={() => setSettingsTab(tab)}><Icon size={17} strokeWidth={1.6} />{label}</button>
            ))}
          </nav>
        </aside>
        <div className="nf-settings-content">
          <header className="nf-content-heading"><h2>{settingsLabel}</h2><button type="button" className="nf-icon-button" data-dialog-initial-focus aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X size={17} strokeWidth={1.6} /></button></header>
          <div ref={settingsScrollRef} className="nf-settings-scroll">
            <section key={settingsTab} className="nf-settings-page" aria-label={settingsLabel + "内容"}>
              {settingsTab === "account" && <>
                <div className="nf-identity"><span className="nf-avatar" aria-hidden="true">{avatar}</span><span className="nf-username" title={accountPrimary}>{accountPrimary}</span></div>
                <button type="button" className="nf-row" aria-expanded={emailOpen} onClick={() => { setEmailOpen((open) => !open); setEmailError(""); setEmailMessage(""); }}>
                  <span className="nf-row-main"><MailCheck size={17} strokeWidth={1.6} />登录邮箱</span><span className="nf-row-end">{userEmailVerified ? "已验证" : "待验证"}<ChevronDown size={14} strokeWidth={1.6} /></span>
                </button>
                {emailOpen && <div className="nf-detail">
                  <label htmlFor={accountPanelId + "-email"}>登录邮箱地址</label>
                  <input id={accountPanelId + "-email"} type="email" aria-label="登录邮箱地址" value={emailDraft} onChange={(event) => { setEmailDraft(event.target.value); setEmailCodeSent(false); setEmailCode(""); }} className="nf-input" placeholder="name@example.com" />
                  {emailCodeSent && <><label htmlFor={accountPanelId + "-code"}>邮箱验证码</label><input id={accountPanelId + "-code"} aria-label="邮箱验证码" value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="nf-input" placeholder="输入 6 位验证码" /></>}
                  {emailError && <p className="nf-notice nf-error" role="alert">{emailError}</p>}
                  {emailMessage && <p className="nf-notice" role="status">{emailMessage}</p>}
                  <button type="button" className="nf-button nf-primary" disabled={emailLoading || !emailDraft.trim() || Boolean(emailCodeSent && emailCode.length !== 6)} onClick={() => void (emailCodeSent ? handleConfirmEmail() : handleRequestEmailCode())}>{emailLoading ? "处理中…" : emailCodeSent ? "确认并绑定" : "发送验证码"}</button>
                </div>}
                <button type="button" className="nf-row" aria-expanded={sessionsOpen} onClick={() => setSessionsOpen((open) => !open)}>
                  <span className="nf-row-main"><MonitorSmartphone size={17} strokeWidth={1.6} />登录设备</span><span className="nf-row-end">{sessions.length ? sessions.length + " 个" : "管理"}<ChevronDown size={14} strokeWidth={1.6} /></span>
                </button>
                {sessionsOpen && <div className="nf-detail">
                  <div className="nf-list-heading"><span>有效会话</span><button type="button" className="nf-button" onClick={() => void reloadSessions()}>刷新</button></div>
                  {sessionError && <p className="nf-notice nf-error" role="alert">{sessionError}</p>}
                  {sessionLoading ? <p className="nf-notice" role="status">正在加载设备…</p> : sessions.length === 0 ? <p className="nf-notice">暂无可管理的会话</p> : sessions.map((session) => (
                    <div key={session.id} className="nf-record nf-device">
                      <MonitorSmartphone size={17} strokeWidth={1.6} /><div className="nf-record-main"><p className="nf-record-title">{sessionDeviceLabel(session.userAgent)}{session.current ? " · 当前设备" : ""}</p><p className="nf-record-meta">{session.ipAddress || "未知地址"} · {new Date(session.lastSeenAt).toLocaleString()}</p></div>
                      <button type="button" className="nf-button nf-danger" onClick={() => void handleRevokeSession(session)}>退出</button>
                    </div>
                  ))}
                </div>}
              </>}

              {settingsTab === "appearance" && <div className="nf-row">
                <span className="nf-row-main"><SunMoon size={17} strokeWidth={1.6} />显示模式</span>
                <div className="nf-segment"><button type="button" aria-pressed={!isDark} onClick={() => onThemeModeChange("light")}>浅色</button><button type="button" aria-pressed={isDark} onClick={() => onThemeModeChange("dark")}>深色</button></div>
              </div>}

              {settingsTab === "data" && <>
                <button type="button" className="nf-row" onClick={handleExportKnowledgeBase}><span className="nf-row-main"><FileArchive size={17} strokeWidth={1.6} />导出笔记备份</span><ArrowUpRight size={16} strokeWidth={1.6} /></button>
                <button type="button" className="nf-row" onClick={handleExportKnowledgeJson}><span className="nf-row-main"><FileJson size={17} strokeWidth={1.6} />导出完整数据</span><ArrowUpRight size={16} strokeWidth={1.6} /></button>
                <button type="button" className="nf-row" onClick={() => importInputRef.current?.click()}><span className="nf-row-main"><Upload size={17} strokeWidth={1.6} />导入笔记文件</span><ArrowUpRight size={16} strokeWidth={1.6} /></button>
                <input ref={importInputRef} type="file" accept=".md,.markdown,.zip,.json,text/markdown,application/zip,application/json" multiple hidden onChange={(event) => void handleImportKnowledge(event.target.files)} />
                {importStatus && <p className="nf-notice" role="status">{importStatus}</p>}
                <button type="button" className="nf-row" onClick={() => setSettingsTab("trash")}><span className="nf-row-main"><Trash size={17} strokeWidth={1.6} />回收站</span><ChevronRight size={16} strokeWidth={1.6} /></button>
              </>}

              {settingsTab === "trash" && <>
                <button type="button" className="nf-back" onClick={() => setSettingsTab("data")}><ChevronLeft size={14} strokeWidth={1.6} />数据管理</button>
                {deletedNotes.length === 0 ? <div className="nf-empty"><Trash size={24} strokeWidth={1.6} /><span>回收站是空的</span></div> : <>
                  <p className="nf-notice">{deletedNotes.length} 篇已删除笔记</p>
                  {deletedNotes.map((note) => <div key={note.id} className="nf-record nf-trash-record">
                    <FileText size={17} strokeWidth={1.6} /><div className="nf-record-main"><p className="nf-record-title">{note.title}</p><p className="nf-record-meta">已移至回收站</p></div>
                    <button type="button" className="nf-button" aria-label={"恢复 " + note.title} onClick={() => restoreDeletedNote(note.id)}><RotateCcw size={14} strokeWidth={1.6} className="inline mr-1" />恢复</button>
                  </div>)}
                </>}
              </>}

              {settingsTab === "memory" && <>
                <div className="nf-row"><span className="nf-row-main"><Sparkles size={17} strokeWidth={1.6} />长期记忆</span><button type="button" className="nf-switch" onClick={() => void handleMemoryEnabledChange()} disabled={memorySettingLoading} aria-pressed={memoryEnabledState} aria-label="长期记忆"><span /></button></div>
                <button type="button" className="nf-row" aria-expanded={memoryOpen} onClick={() => setMemoryOpen((open) => !open)}><span>记忆管理</span><span className="nf-row-end">{pendingMemoryCount ? activeMemoryCount + " 条 · " + pendingMemoryCount + " 待确认" : activeMemoryCount + " 条"}<ChevronDown size={14} strokeWidth={1.6} /></span></button>
                {memoryError && <p className="nf-notice nf-error" role="alert">{memoryError}</p>}
                {memoryOpen && <div className="nf-detail">
                  <div className="nf-list-heading"><span>记忆列表</span><button type="button" className="nf-button" onClick={() => void reloadMemories()}>刷新</button></div>
                  {memoryLoading ? <p className="nf-notice" role="status">正在加载记忆…</p> : memories.filter((memory) => memory.status !== "deleted").length === 0 ? <p className="nf-notice">暂无长期记忆</p> : groupMemories(memories).map(([label, items]) => <div key={label}>
                    <p className="nf-notice">{label}</p>
                    {items.map((memory) => {
                      const isEditing = editingMemoryId === memory.id;
                      const archived = memory.status === "archived", pending = memory.status === "pending";
                      return <div key={memory.id} className="nf-record">
                        <div className="nf-record-meta"><span>{memoryLayerLabel(memory.layer)} · 重要度 {memory.importance}</span><span>{pending ? "待确认" : archived ? "已停用" : "启用中"}</span></div>
                        {isEditing ? <textarea value={editingContent} aria-label="记忆内容" onChange={(event) => setEditingContent(event.target.value)} className="nf-input" /> : <p className="nf-record-title">{memory.content}</p>}
                        <div className="nf-record-actions">{isEditing ? <>
                          <button type="button" className="nf-icon-button" onClick={() => void saveEditMemory(memory)} aria-label="保存记忆"><Check size={16} strokeWidth={1.6} /></button>
                          <button type="button" className="nf-icon-button" onClick={() => { setEditingMemoryId(null); setEditingContent(""); }} aria-label="取消编辑"><X size={16} strokeWidth={1.6} /></button>
                        </> : <>
                          <button type="button" className="nf-button" onClick={() => void toggleMemoryStatus(memory)}>{pending ? "确认" : archived ? "启用" : "停用"}</button>
                          <button type="button" className="nf-icon-button" onClick={() => startEditMemory(memory)} aria-label="编辑记忆"><Pencil size={16} strokeWidth={1.6} /></button>
                          <button type="button" className="nf-icon-button" onClick={() => void removeMemory(memory)} aria-label="删除记忆"><Trash2 size={16} strokeWidth={1.6} /></button>
                        </>}</div>
                      </div>;
                    })}
                  </div>)}
                </div>}
              </>}
            </section>
          </div>
        </div>
      </OverlayDialog>
    </div>
  );
}
