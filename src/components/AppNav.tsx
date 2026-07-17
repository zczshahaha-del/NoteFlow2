import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Check,
  FileArchive,
  FileJson,
  LogOut,
  Moon,
  MonitorSmartphone,
  Pencil,
  Power,
  Settings,
  Sun,
  Trash2,
  UserRound,
  Upload,
  X,
} from "lucide-react";
import { generateId } from "../store";
import { useWorkspaceSlice } from "../storeSlices";
import type { FileNode } from "../types";
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
  countKnowledgeFiles,
  createKnowledgeZipBlob,
  createKnowledgeJsonBlob,
  downloadBlob,
  makeKnowledgeBackupName,
  makeKnowledgeJsonName,
} from "../utils/exportKnowledgeZip";
import { parseKnowledgeImport } from "../utils/importKnowledge";
import {
  listUserSessions,
  revokeUserSession,
  type UserSessionRecord,
} from "../services/auth";

export type AppView = "knowledge";
type ThemeMode = "light" | "dark";

export interface AccountMenuProps {
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  userEmail: string;
  userName?: string;
  onSignOut: () => void | Promise<void>;
  compact?: boolean;
}

function countFolders(nodes: FileNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.type !== "folder") return total;
    return total + 1 + countFolders(node.children ?? []);
  }, 0);
}

function AccountMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-jelly-border bg-jelly-card px-2.5 py-2">
      <p className="text-[12px] text-jelly-text-muted">{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold text-jelly-text">{value}</p>
    </div>
  );
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
  userName,
  onSignOut,
  compact = false,
}: AccountMenuProps) {
  const [accountOpen, setAccountOpen] = useState(false);
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
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const accountRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const displayName = userName?.trim() || userEmail.split("@")[0] || "NoteFlow";
  const initial = displayName.slice(0, 1).toUpperCase();
  const { treeData, fileContents, addNode, setSelectedFileId } = useWorkspaceSlice();
  const isDark = themeMode === "dark";

  const stats = useMemo(
    () => ({
      files: countKnowledgeFiles(treeData),
      folders: countFolders(treeData),
      chars: Object.values(fileContents).reduce((total, content) => total + content.length, 0),
    }),
    [fileContents, treeData]
  );

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
    if (accountOpen && memoryOpen) {
      void reloadMemories();
    }
  }, [accountOpen, memoryOpen]);

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
  const buttonSizeClass = compact ? "h-8 w-8 text-[12px]" : "h-10 w-10 text-[13px]";

  return (
      <div ref={accountRef} className="relative shrink-0 overflow-visible">
        <button
          type="button"
          onClick={() => setAccountOpen((open) => !open)}
          className={`flex ${buttonSizeClass} items-center justify-center rounded-full border font-semibold transition-all duration-200 ${
            accountOpen
              ? "border-jelly-blue bg-jelly-blue-pale text-jelly-blue-deep"
              : "border-jelly-border bg-white text-jelly-text-soft hover:border-jelly-blue/35 hover:text-jelly-blue-deep"
          }`}
          aria-label="账号菜单"
        >
          {initial || <UserRound size={17} strokeWidth={1.8} />}
        </button>

        {accountOpen && (
          <div className="panel-surface absolute bottom-0 left-full z-50 ml-2.5 max-h-[calc(100vh-24px)] w-[360px] overflow-y-auto p-2">
            <div className="flex min-w-0 items-center gap-3 border-b border-jelly-border px-2 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-jelly-blue-pale text-[13px] font-semibold text-jelly-blue-deep">
                {initial || <UserRound size={15} strokeWidth={1.8} />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-jelly-text">{displayName}</p>
                <p className="mt-0.5 truncate text-[12px] text-jelly-text-muted">{userEmail}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 px-1.5 py-2.5">
              <AccountMetric label="笔记" value={stats.files} />
              <AccountMetric label="目录" value={stats.folders} />
              <AccountMetric label="字符" value={stats.chars.toLocaleString()} />
            </div>

            <div className="border-t border-jelly-border px-1.5 py-1.5">
              <div className="mb-1 flex items-center gap-2 px-1 text-[12px] font-medium text-jelly-text-muted">
                <Settings size={13} strokeWidth={1.8} />
                资料与偏好
              </div>

              <button
                type="button"
                onClick={() => onThemeModeChange(isDark ? "light" : "dark")}
                className="flex h-9 w-full items-center justify-between rounded-md px-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
              >
                <span className="flex items-center gap-2">
                  {isDark ? <Moon size={14} strokeWidth={1.8} /> : <Sun size={14} strokeWidth={1.8} />}
                  显示模式
                </span>
                <span className="font-medium text-jelly-text">{isDark ? "深色" : "浅色"}</span>
              </button>

              <button
                type="button"
                onClick={handleExportKnowledgeBase}
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
              >
                <FileArchive size={14} strokeWidth={1.8} />
                导出笔记备份
              </button>

              <button
                type="button"
                onClick={handleExportKnowledgeJson}
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
              >
                <FileJson size={14} strokeWidth={1.8} />
                导出完整数据
              </button>

              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
              >
                <Upload size={14} strokeWidth={1.8} />
                导入笔记文件
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".md,.markdown,.zip,.json,text/markdown,application/zip,application/json"
                multiple
                className="hidden"
                onChange={(event) => void handleImportKnowledge(event.target.files)}
              />
              {importStatus && <p className="px-2 py-1 text-[11px] leading-5 text-jelly-text-muted">{importStatus}</p>}

              <button
                type="button"
                onClick={() => void handleMemoryEnabledChange()}
                disabled={memorySettingLoading}
                className="flex h-9 w-full items-center justify-between rounded-md px-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
              >
                <span className="flex items-center gap-2">
                  <Power size={14} strokeWidth={1.8} />
                  长期记忆
                </span>
                <span className="font-medium text-jelly-text">
                  {memorySettingLoading ? "同步中" : memoryEnabledState ? "开启" : "关闭"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMemoryOpen((open) => !open)}
                className="flex h-9 w-full items-center justify-between rounded-md px-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
              >
                <span className="flex items-center gap-2">
                  <Brain size={14} strokeWidth={1.8} />
                  记忆管理
                </span>
                <span className="font-medium text-jelly-text">
                  {memoryOpen ? "收起" : pendingMemoryCount ? `${activeMemoryCount} 条 / ${pendingMemoryCount} 待确认` : `${activeMemoryCount} 条`}
                </span>
              </button>

              {memoryOpen && (
                <div className="mt-1.5 rounded-md border border-jelly-border bg-jelly-surface p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-jelly-text-muted">
                      记忆状态
                    </span>
                    <button
                      type="button"
                      onClick={() => void reloadMemories()}
                      className="rounded-md px-2 py-1 text-[12px] text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
                    >
                      刷新
                    </button>
                  </div>

                  {memoryError && (
                    <div className="mb-2 rounded-md border border-jelly-red/25 bg-jelly-red-bg px-2 py-1.5 text-[12px] leading-relaxed text-jelly-red">
                      {memoryError}
                    </div>
                  )}

                  {memoryLoading ? (
                    <div className="rounded-md border border-jelly-border bg-white px-2 py-3 text-center text-[12px] text-jelly-text-muted">
                      正在加载记忆...
                    </div>
                  ) : memories.filter((memory) => memory.status !== "deleted").length === 0 ? (
                    <div className="rounded-md border border-jelly-border bg-white px-2 py-3 text-center text-[12px] leading-relaxed text-jelly-text-muted">
                      暂无长期记忆
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {groupMemories(memories).map(([label, items]) => (
                        <div key={label}>
                          <div className="mb-1 px-1 text-[12px] font-semibold text-jelly-text-muted">
                            {label}
                          </div>
                          <div className="space-y-1.5">
                            {items.map((memory) => {
                              const isEditing = editingMemoryId === memory.id;
                              const archived = memory.status === "archived";
                              const pending = memory.status === "pending";
                              return (
                                <div
                                  key={memory.id}
                                  className={`rounded-md border px-2 py-2 ${
                                    pending
                                      ? "border-jelly-blue/35 bg-jelly-blue-pale"
                                      : archived
                                      ? "border-jelly-border bg-white/55 opacity-70"
                                      : "border-jelly-border bg-white"
                                  }`}
                                >
                                  <div className="mb-1 flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-1">
                                      <span className="rounded-md bg-jelly-blue-pale px-1.5 py-0.5 text-[11px] font-medium text-jelly-blue-deep">
                                        {memoryLayerLabel(memory.layer)}
                                      </span>
                                      <span className="rounded-md bg-jelly-surface px-1.5 py-0.5 text-[11px] font-medium text-jelly-text-muted">
                                        重要度 {memory.importance}
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-jelly-text-muted">
                                      {pending ? "待确认" : archived ? "已停用" : "启用中"}
                                    </span>
                                  </div>
                                  {isEditing ? (
                                    <textarea
                                      value={editingContent}
                                      onChange={(event) => setEditingContent(event.target.value)}
                                      className="min-h-16 w-full resize-none rounded-md border border-jelly-border bg-white px-2 py-1.5 text-[12px] leading-relaxed text-jelly-text outline-none focus:border-jelly-blue/40"
                                    />
                                  ) : (
                                    <p className="text-[12px] leading-relaxed text-jelly-text-soft">
                                      {memory.content}
                                    </p>
                                  )}
                                  <div className="mt-2 flex items-center justify-end gap-1">
                                    {isEditing ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => void saveEditMemory(memory)}
                                          className="flex h-7 w-7 items-center justify-center rounded-md text-jelly-green hover:bg-jelly-green-bg"
                                          aria-label="保存记忆"
                                          title="保存"
                                        >
                                          <Check size={14} strokeWidth={1.9} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingMemoryId(null);
                                            setEditingContent("");
                                          }}
                                          className="flex h-7 w-7 items-center justify-center rounded-md text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-text"
                                          aria-label="取消编辑"
                                          title="取消"
                                        >
                                          <X size={14} strokeWidth={1.9} />
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => void toggleMemoryStatus(memory)}
                                          className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
                                        >
                                          {pending ? "确认" : archived ? "启用" : "停用"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => startEditMemory(memory)}
                                          className="flex h-7 w-7 items-center justify-center rounded-md text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
                                          aria-label="编辑记忆"
                                          title="编辑"
                                        >
                                          <Pencil size={14} strokeWidth={1.8} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void removeMemory(memory)}
                                          className="flex h-7 w-7 items-center justify-center rounded-md text-jelly-red hover:bg-jelly-red-bg"
                                          aria-label="删除记忆"
                                          title="删除"
                                        >
                                          <Trash2 size={14} strokeWidth={1.8} />
                                        </button>
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

              <button
                type="button"
                onClick={() => setSessionsOpen((open) => !open)}
                className="flex h-9 w-full items-center justify-between rounded-md px-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
              >
                <span className="flex items-center gap-2">
                  <MonitorSmartphone size={14} strokeWidth={1.8} />
                  登录设备
                </span>
                <span className="font-medium text-jelly-text">
                  {sessionsOpen ? "收起" : sessions.length ? `${sessions.length} 个` : "管理"}
                </span>
              </button>

              {sessionsOpen && (
                <div className="mt-1.5 rounded-md border border-jelly-border bg-jelly-surface p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-jelly-text-muted">有效会话</span>
                    <button
                      type="button"
                      onClick={() => void reloadSessions()}
                      className="rounded-md px-2 py-1 text-[12px] text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
                    >
                      刷新
                    </button>
                  </div>
                  {sessionError && (
                    <p className="mb-2 rounded-md border border-jelly-red/25 bg-jelly-red-bg px-2 py-1.5 text-[12px] text-jelly-red">{sessionError}</p>
                  )}
                  {sessionLoading ? (
                    <p className="rounded-md bg-white px-2 py-3 text-center text-[12px] text-jelly-text-muted">正在加载设备…</p>
                  ) : sessions.length === 0 ? (
                    <p className="rounded-md bg-white px-2 py-3 text-center text-[12px] text-jelly-text-muted">暂无可管理的会话</p>
                  ) : (
                    <div className="space-y-1.5">
                      {sessions.map((session) => (
                        <div key={session.id} className="flex items-center gap-2 rounded-md border border-jelly-border bg-white px-2 py-2">
                          <MonitorSmartphone size={14} className="shrink-0 text-jelly-text-muted" strokeWidth={1.8} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] font-medium text-jelly-text">
                              {sessionDeviceLabel(session.userAgent)}{session.current ? " · 当前设备" : ""}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-jelly-text-muted">
                              {session.ipAddress || "未知地址"} · {new Date(session.lastSeenAt).toLocaleString()}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleRevokeSession(session)}
                            className="shrink-0 rounded-md px-2 py-1 text-[11px] text-jelly-red hover:bg-jelly-red-bg"
                          >
                            退出
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-jelly-border pt-1.5">
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-jelly-red hover:bg-jelly-red-bg"
              >
                <LogOut size={14} strokeWidth={1.8} />
                退出登录
              </button>
            </div>
          </div>
        )}
      </div>
  );
}
