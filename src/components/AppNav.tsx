import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  FileArchive,
  FileJson,
  LogOut,
  MailCheck,
  MonitorSmartphone,
  Pencil,
  Settings,
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
  onOpenTrash?: () => void;
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
  onOpenTrash,
}: AccountMenuProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "memory" | "data">("general");
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
  const importInputRef = useRef<HTMLInputElement>(null);
  const displayName = userName?.trim() || userEmail.split("@")[0] || "NoteFlow";
  const emailLocalPart = userEmail.split("@")[0]?.trim().toLowerCase() || "";
  const hasDistinctDisplayName = Boolean(
    userName?.trim() && userName.trim().toLowerCase() !== emailLocalPart
  );
  const accountPrimary = hasDistinctDisplayName ? displayName : "我的账号";
  const { treeData, fileContents, addNode, setSelectedFileId } = useWorkspaceSlice();
  const isDark = themeMode === "dark";

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [settingsOpen]);

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
    if (accountOpen && sessionsOpen) void reloadSessions();
  }, [accountOpen, sessionsOpen]);

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
  const utilityButtonClass = "h-9 w-9 justify-center rounded-lg";
  const accountButtonClass = compact
    ? "h-9 w-9 justify-center rounded-lg"
    : "h-11 flex-1 gap-2 rounded-lg px-1.5 text-left";

  return (
    <div ref={accountRef} className={`relative shrink-0 overflow-visible ${compact ? "" : "w-full"}`}>
      <div className={`flex items-center gap-1 ${compact ? "flex-col" : ""}`}>
      {onOpenTrash && (
        <button
          type="button"
          onClick={() => {
            setAccountOpen(false);
            setSettingsOpen(false);
            onOpenTrash();
          }}
          className={`group order-2 flex ${utilityButtonClass} relative items-center border border-transparent text-jelly-text-soft transition-colors hover:bg-jelly-surface hover:text-jelly-text`}
          aria-label="回收站"
          title="回收站"
        >
          <Trash2 size={16} strokeWidth={1.8} />
          {trashCount > 0 && (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-jelly-blue" />
          )}
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          setAccountOpen(false);
          setSettingsOpen(true);
        }}
        className={`group order-3 flex ${utilityButtonClass} items-center border border-transparent text-jelly-text-soft transition-colors hover:bg-jelly-surface hover:text-jelly-text`}
        aria-label="设置"
        title="设置"
      >
        <Settings size={16} strokeWidth={1.8} />
      </button>

      <button
        type="button"
        onClick={() => {
          setSettingsOpen(false);
          setAccountOpen((open) => !open);
        }}
        className={`group order-1 flex ${accountButtonClass} min-w-0 items-center border border-transparent font-semibold transition-colors duration-150 ${
          accountOpen
            ? "bg-jelly-blue-pale text-jelly-blue-deep"
            : "bg-transparent text-jelly-text-soft hover:bg-jelly-surface hover:text-jelly-text"
        }`}
        aria-label="我的账号"
        title={compact ? "我的账号" : undefined}
      >
        {compact ? (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-jelly-blue text-white">
            <UserRound size={16} strokeWidth={1.9} />
          </span>
        ) : (
          <>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-jelly-blue text-white">
              <UserRound size={16} strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold tracking-[-0.01em] text-jelly-text">{accountPrimary}</span>
            </span>
            <ChevronRight size={14} className={`shrink-0 transition-transform ${accountOpen ? "rotate-90" : ""}`} strokeWidth={1.9} />
          </>
        )}
      </button>
      </div>

      {accountOpen && (
        <div className="panel-surface absolute bottom-0 left-full z-50 ml-2.5 max-h-[calc(100vh-24px)] w-[340px] overflow-y-auto p-2">
          <div className="flex min-w-0 items-center gap-3 border-b border-jelly-border px-2 py-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-jelly-blue text-white">
              <UserRound size={17} strokeWidth={1.9} />
            </div>
            <p className="truncate text-[13px] font-semibold text-jelly-text">{accountPrimary}</p>
          </div>

          <div className="px-1.5 py-1.5">
            <button
              type="button"
              onClick={() => {
                setEmailOpen((open) => !open);
                setEmailError("");
                setEmailMessage("");
              }}
              className="flex h-10 w-full items-center justify-between rounded-lg px-2 text-left text-[13px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
              aria-expanded={emailOpen}
            >
              <span className="flex items-center gap-2.5">
                <MailCheck size={16} strokeWidth={1.8} />
                登录邮箱
              </span>
              <span className={`text-[11px] font-medium ${userEmailVerified ? "text-jelly-green" : "text-jelly-amber"}`}>
                {userEmailVerified ? "已验证" : "待验证"}
              </span>
            </button>

            {emailOpen && (
              <div className="mb-1 mt-1 rounded-lg border border-jelly-border bg-jelly-surface p-2.5">
                <input
                  type="email"
                  value={emailDraft}
                  onChange={(event) => {
                    setEmailDraft(event.target.value);
                    setEmailCodeSent(false);
                    setEmailCode("");
                  }}
                  className="ui-input h-9 w-full px-2.5 text-[12px] outline-none"
                  placeholder="name@example.com"
                />
                {emailCodeSent && (
                  <input
                    value={emailCode}
                    onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="ui-input mt-2 h-9 w-full px-2.5 text-[12px] tracking-[0.18em] outline-none"
                    placeholder="输入 6 位验证码"
                  />
                )}
                {emailError && <p className="mt-2 text-[11px] leading-5 text-jelly-red">{emailError}</p>}
                {emailMessage && <p className="mt-2 text-[11px] leading-5 text-jelly-green">{emailMessage}</p>}
                <button
                  type="button"
                  disabled={emailLoading || !emailDraft.trim() || Boolean(emailCodeSent && emailCode.length !== 6)}
                  onClick={() => void (emailCodeSent ? handleConfirmEmail() : handleRequestEmailCode())}
                  className="ui-button ui-button-primary mt-2 h-8 w-full px-3 text-[12px]"
                >
                  {emailLoading ? "处理中…" : emailCodeSent ? "确认并绑定" : "发送验证码"}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSessionsOpen((open) => !open)}
              className="flex h-10 w-full items-center justify-between rounded-lg px-2 text-left text-[13px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
              aria-expanded={sessionsOpen}
            >
              <span className="flex items-center gap-2.5">
                <MonitorSmartphone size={16} strokeWidth={1.8} />
                登录设备
              </span>
              <span className="text-[11px] font-medium text-jelly-text-muted">
                {sessions.length ? `${sessions.length} 个` : "管理"}
              </span>
            </button>

            {sessionsOpen && (
              <div className="mt-1.5 rounded-lg border border-jelly-border bg-jelly-surface p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-jelly-text-muted">有效会话</span>
                  <button type="button" onClick={() => void reloadSessions()} className="rounded-md px-2 py-1 text-[12px] text-jelly-text-muted hover:bg-jelly-blue-pale">刷新</button>
                </div>
                {sessionError && <p className="mb-2 rounded-md bg-jelly-red-bg px-2 py-1.5 text-[12px] text-jelly-red">{sessionError}</p>}
                {sessionLoading ? (
                  <p className="px-2 py-3 text-center text-[12px] text-jelly-text-muted">正在加载设备…</p>
                ) : sessions.length === 0 ? (
                  <p className="px-2 py-3 text-center text-[12px] text-jelly-text-muted">暂无可管理的会话</p>
                ) : (
                  <div className="space-y-1.5">
                    {sessions.map((session) => (
                      <div key={session.id} className="flex items-center gap-2 rounded-md border border-jelly-border bg-white px-2 py-2">
                        <MonitorSmartphone size={14} className="shrink-0 text-jelly-text-muted" strokeWidth={1.8} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-medium text-jelly-text">{sessionDeviceLabel(session.userAgent)}{session.current ? " · 当前设备" : ""}</p>
                          <p className="mt-0.5 truncate text-[11px] text-jelly-text-muted">{session.ipAddress || "未知地址"} · {new Date(session.lastSeenAt).toLocaleString()}</p>
                        </div>
                        <button type="button" onClick={() => void handleRevokeSession(session)} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-jelly-red hover:bg-jelly-red-bg">退出</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-jelly-border pt-1.5">
            <button type="button" onClick={() => void onSignOut()} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-jelly-red hover:bg-jelly-red-bg">
              <LogOut size={14} strokeWidth={1.8} />
              退出登录
            </button>
          </div>
        </div>
      )}

      {settingsOpen && createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/15 p-4 backdrop-blur-[1px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="panel-surface flex max-h-[calc(100vh-32px)] w-[min(620px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl" role="dialog" aria-modal="true" aria-label="设置">
            <header className="flex h-14 shrink-0 items-center justify-between px-5">
              <h2 className="text-[15px] font-semibold text-jelly-text">设置</h2>
              <button type="button" onClick={() => setSettingsOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-jelly-text-muted hover:bg-jelly-surface hover:text-jelly-text" aria-label="关闭设置">
                <X size={17} strokeWidth={1.8} />
              </button>
            </header>

            <nav className="flex shrink-0 gap-1 border-b border-jelly-border px-5">
              {([
                ["general", "通用"],
                ["memory", "AI 与记忆"],
                ["data", "数据管理"],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSettingsTab(tab)}
                  className={`relative h-10 px-3 text-[13px] transition-colors ${
                    settingsTab === tab ? "font-medium text-jelly-blue-deep after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-jelly-blue" : "text-jelly-text-muted hover:text-jelly-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            <section className="min-h-0 flex-1 overflow-y-auto bg-white">
              <div className="p-5">
                {settingsTab === "general" && (
                  <div className="rounded-xl border border-jelly-border">
                    <div className="flex items-center justify-between gap-6 px-4 py-4">
                      <p className="text-[13px] font-medium text-jelly-text">显示模式</p>
                      <div className="flex rounded-lg bg-jelly-surface p-1">
                        <button type="button" onClick={() => onThemeModeChange("light")} className={`h-8 rounded-md px-3 text-[12px] ${!isDark ? "bg-white font-medium text-jelly-text shadow-sm" : "text-jelly-text-muted"}`}>浅色</button>
                        <button type="button" onClick={() => onThemeModeChange("dark")} className={`h-8 rounded-md px-3 text-[12px] ${isDark ? "bg-white font-medium text-jelly-text shadow-sm" : "text-jelly-text-muted"}`}>深色</button>
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === "data" && (
                  <div className="space-y-3">
                    <button type="button" onClick={handleExportKnowledgeBase} className="flex h-13 w-full items-center gap-3 rounded-xl border border-jelly-border px-4 text-left hover:border-jelly-blue/40 hover:bg-jelly-blue-pale/40">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-jelly-blue-pale text-jelly-blue-deep"><FileArchive size={16} /></span>
                      <span className="text-[13px] font-medium text-jelly-text">导出笔记备份</span>
                    </button>
                    <button type="button" onClick={handleExportKnowledgeJson} className="flex h-13 w-full items-center gap-3 rounded-xl border border-jelly-border px-4 text-left hover:border-jelly-blue/40 hover:bg-jelly-blue-pale/40">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-jelly-surface text-jelly-text-soft"><FileJson size={16} /></span>
                      <span className="text-[13px] font-medium text-jelly-text">导出完整数据</span>
                    </button>
                    <button type="button" onClick={() => importInputRef.current?.click()} className="flex h-13 w-full items-center gap-3 rounded-xl border border-jelly-border px-4 text-left hover:border-jelly-blue/40 hover:bg-jelly-blue-pale/40">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-jelly-surface text-jelly-text-soft"><Upload size={16} /></span>
                      <span className="text-[13px] font-medium text-jelly-text">导入笔记文件</span>
                    </button>
                    <input ref={importInputRef} type="file" accept=".md,.markdown,.zip,.json,text/markdown,application/zip,application/json" multiple className="hidden" onChange={(event) => void handleImportKnowledge(event.target.files)} />
                    {importStatus && <p className="px-1 text-[12px] text-jelly-text-muted">{importStatus}</p>}
                  </div>
                )}

                {settingsTab === "memory" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-6 rounded-xl border border-jelly-border px-4 py-4">
                      <p className="text-[13px] font-medium text-jelly-text">长期记忆</p>
                      <button
                        type="button"
                        onClick={() => void handleMemoryEnabledChange()}
                        disabled={memorySettingLoading}
                        aria-pressed={memoryEnabledState}
                        aria-label="长期记忆"
                        className={`relative h-6 w-11 rounded-full transition-colors ${memoryEnabledState ? "bg-jelly-blue" : "bg-jelly-border"}`}
                      >
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${memoryEnabledState ? "translate-x-5" : "translate-x-0.5"}`} />
                      </button>
                    </div>

                    <button type="button" onClick={() => setMemoryOpen((open) => !open)} className="flex w-full items-center justify-between rounded-xl border border-jelly-border px-4 py-4 text-left hover:bg-jelly-surface/60">
                      <span className="text-[13px] font-medium text-jelly-text">记忆管理</span>
                      <span className="flex items-center gap-2 text-[12px] text-jelly-text-muted">
                        {pendingMemoryCount ? `${activeMemoryCount} 条 · ${pendingMemoryCount} 待确认` : `${activeMemoryCount} 条`}
                        <ChevronRight size={14} className={`transition-transform ${memoryOpen ? "rotate-90" : ""}`} />
                      </span>
                    </button>

                    {memoryError && <div className="rounded-lg bg-jelly-red-bg px-3 py-2 text-[12px] text-jelly-red">{memoryError}</div>}
                    {memoryOpen && (
                      <div className="rounded-xl border border-jelly-border p-3">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-[12px] font-medium text-jelly-text-muted">记忆列表</span>
                          <button type="button" onClick={() => void reloadMemories()} className="rounded-md px-2 py-1 text-[12px] text-jelly-text-muted hover:bg-jelly-surface">刷新</button>
                        </div>
                        {memoryLoading ? (
                          <p className="py-6 text-center text-[12px] text-jelly-text-muted">正在加载记忆…</p>
                        ) : memories.filter((memory) => memory.status !== "deleted").length === 0 ? (
                          <p className="py-6 text-center text-[12px] text-jelly-text-muted">暂无长期记忆</p>
                        ) : (
                          <div className="space-y-3">
                            {groupMemories(memories).map(([label, items]) => (
                              <div key={label}>
                                <p className="mb-1.5 px-1 text-[11px] font-semibold text-jelly-text-muted">{label}</p>
                                <div className="space-y-2">
                                  {items.map((memory) => {
                                    const isEditing = editingMemoryId === memory.id;
                                    const archived = memory.status === "archived";
                                    const pending = memory.status === "pending";
                                    return (
                                      <div key={memory.id} className={`rounded-lg border px-3 py-2.5 ${pending ? "border-jelly-blue/35 bg-jelly-blue-pale" : archived ? "border-jelly-border bg-jelly-surface/60 opacity-70" : "border-jelly-border"}`}>
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                          <span className="text-[11px] text-jelly-text-muted">{memoryLayerLabel(memory.layer)} · 重要度 {memory.importance}</span>
                                          <span className="text-[11px] text-jelly-text-muted">{pending ? "待确认" : archived ? "已停用" : "启用中"}</span>
                                        </div>
                                        {isEditing ? (
                                          <textarea value={editingContent} onChange={(event) => setEditingContent(event.target.value)} className="min-h-16 w-full resize-none rounded-md border border-jelly-border px-2 py-1.5 text-[12px] text-jelly-text outline-none" />
                                        ) : (
                                          <p className="text-[12px] leading-relaxed text-jelly-text-soft">{memory.content}</p>
                                        )}
                                        <div className="mt-2 flex justify-end gap-1">
                                          {isEditing ? (
                                            <>
                                              <button type="button" onClick={() => void saveEditMemory(memory)} className="grid h-7 w-7 place-items-center rounded-md text-jelly-green hover:bg-jelly-green-bg" aria-label="保存记忆"><Check size={14} /></button>
                                              <button type="button" onClick={() => { setEditingMemoryId(null); setEditingContent(""); }} className="grid h-7 w-7 place-items-center rounded-md text-jelly-text-muted hover:bg-jelly-surface" aria-label="取消编辑"><X size={14} /></button>
                                            </>
                                          ) : (
                                            <>
                                              <button type="button" onClick={() => void toggleMemoryStatus(memory)} className="h-7 rounded-md px-2 text-[12px] text-jelly-text-muted hover:bg-jelly-blue-pale">{pending ? "确认" : archived ? "启用" : "停用"}</button>
                                              <button type="button" onClick={() => startEditMemory(memory)} className="grid h-7 w-7 place-items-center rounded-md text-jelly-text-muted hover:bg-jelly-surface" aria-label="编辑记忆"><Pencil size={14} /></button>
                                              <button type="button" onClick={() => void removeMemory(memory)} className="grid h-7 w-7 place-items-center rounded-md text-jelly-red hover:bg-jelly-red-bg" aria-label="删除记忆"><Trash2 size={14} /></button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
