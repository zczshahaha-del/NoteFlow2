import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  Plus,
  Search,
  X,
  FolderPlus,
  FilePlus,
  BookOpen,
  Pin,
  PinOff,
  MoreHorizontal,
  Pencil,
  FolderInput,
  Trash2,
  Download,
  RotateCcw,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  Star,
} from "lucide-react";
import { generateId } from "../store";
import { useEditorSlice, useWorkspaceSlice } from "../storeSlices";
import type { ChatSource, FileNode } from "../types";
import AccountMenu, { type AccountMenuProps } from "./AppNav";
import { searchNotes, type NoteSearchQueryPlan } from "../services/notes";

function filterTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query) return nodes;
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "file" && node.name.toLowerCase().includes(query.toLowerCase())) {
      result.push(node);
    } else if (node.type === "folder" && node.children) {
      const filtered = filterTree(node.children, query);
      if (filtered.length > 0) {
        result.push({ ...node, children: filtered });
      } else if (node.name.toLowerCase().includes(query.toLowerCase())) {
        result.push(node);
      }
    }
  }
  return result;
}

type LibraryView = "all" | "pinned" | "favorites" | "recent";

function filterTreeByMetadata(
  nodes: FileNode[],
  view: LibraryView,
  tag: string
): FileNode[] {
  if (view === "recent") {
    const files: FileNode[] = [];
    const visit = (items: FileNode[]) => items.forEach((item) => {
      if (item.type === "file") files.push(item);
      else visit(item.children ?? []);
    });
    visit(nodes);
    return files
      .filter((node) => !tag || (node.tags ?? []).includes(tag))
      .sort((a, b) => {
        const left = new Date(a.lastOpenedAt ?? a.updatedAt ?? a.createdAt ?? 0).getTime();
        const right = new Date(b.lastOpenedAt ?? b.updatedAt ?? b.createdAt ?? 0).getTime();
        return right - left;
      })
      .slice(0, 16);
  }

  return nodes.flatMap((node) => {
    if (node.type === "file") {
      const matchesView = view === "all" || (view === "pinned" ? node.pinned : node.favorite);
      const matchesTag = !tag || (node.tags ?? []).includes(tag);
      return matchesView && matchesTag ? [node] : [];
    }
    const children = filterTreeByMetadata(node.children ?? [], view, tag);
    if (view === "all" && !tag) {
      return [{ ...node, children }];
    }
    return children.length ? [{ ...node, children }] : [];
  });
}

function collectTags(nodes: FileNode[], result = new Set<string>()): string[] {
  nodes.forEach((node) => {
    (node.tags ?? []).forEach((tag) => result.add(tag));
    if (node.children) collectTags(node.children, result);
  });
  return Array.from(result).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function countFiles(nodes: FileNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.type === "file") return total + 1;
    return total + countFiles(node.children ?? []);
  }, 0);
}

function countFolders(nodes: FileNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.type !== "folder") return total;
    return total + 1 + countFolders(node.children ?? []);
  }, 0);
}

function collectFilePaths(nodes: FileNode[], parents: string[] = [], paths = new Map<string, string>()): Map<string, string> {
  nodes.forEach((node) => {
    if (node.type === "file") {
      paths.set(node.id, parents.join(" / ") || "知识库");
      return;
    }
    collectFilePaths(node.children ?? [], [...parents, node.name], paths);
  });
  return paths;
}

function searchChannelLabel(source: ChatSource): string {
  const channels = source.retrievalChannels ?? [];
  const labels = [
    channels.includes("heading") || source.sourceType === "heading" ? "标题" : "",
    channels.includes("content") || source.sourceType === "content" ? "正文" : "",
    channels.includes("vector") || source.sourceType === "vector" ? "语义" : "",
  ].filter(Boolean);
  if (labels.length) return labels.join("+");
  return "匹配";
}

function sortPinnedFirst(nodes: FileNode[]): FileNode[] {
  return [...nodes]
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    .map((node) =>
      node.children ? { ...node, children: sortPinnedFirst(node.children) } : node
    );
}

function normalizeNodeName(node: FileNode, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return node.name;
  if (node.type === "file") {
    return trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  }
  return trimmed.replace(/\.md$/, "");
}

function collectFolderIds(node: FileNode): Set<string> {
  const ids = new Set<string>([node.id]);
  for (const child of node.children ?? []) {
    collectFolderIds(child).forEach((id) => ids.add(id));
  }
  return ids;
}

function flattenFolders(
  nodes: FileNode[],
  excludeIds = new Set<string>(),
  prefix = ""
): Array<{ id: string | null; label: string }> {
  const folders: Array<{ id: string | null; label: string }> = [];
  for (const node of nodes) {
    if (node.type !== "folder" || excludeIds.has(node.id)) continue;
    const path = prefix ? `${prefix} / ${node.name}` : node.name;
    folders.push({ id: node.id, label: path });
    folders.push(...flattenFolders(node.children ?? [], excludeIds, path));
  }
  return folders;
}

interface DeleteTargetState {
  node: FileNode;
}

function TreeNode({
  node,
  depth = 0,
  autoExpand = false,
  renamingId,
  renameDraft,
  menuNodeId,
  onRenameDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onStartMove,
  onExport,
  onDelete,
  onTogglePin,
  onToggleFavorite,
  onMenuChange,
  onFileOpen,
}: {
  node: FileNode;
  depth?: number;
  autoExpand?: boolean;
  renamingId: string | null;
  renameDraft: string;
  menuNodeId: string | null;
  onRenameDraftChange: (value: string) => void;
  onStartRename: (node: FileNode) => void;
  onCommitRename: (node: FileNode) => void;
  onCancelRename: () => void;
  onStartMove: (node: FileNode) => void;
  onExport: (node: FileNode) => void;
  onDelete: (node: FileNode) => void;
  onTogglePin: (node: FileNode) => void;
  onToggleFavorite: (node: FileNode) => void;
  onMenuChange: (id: string | null) => void;
  onFileOpen?: () => void;
}) {
  const {
    selectedFileId,
    setSelectedFileId,
    expandedFolderIds,
    toggleFolder,
  } = useWorkspaceSlice();
  const isExpanded = expandedFolderIds.has(node.id) || autoExpand;
  const isSelected = selectedFileId === node.id;
  const isFolder = node.type === "folder";
  const hasChildren = isFolder && node.children && node.children.length > 0;
  const isRenaming = renamingId === node.id;
  const menuOpen = menuNodeId === node.id;
  const PinIcon = node.pinned ? PinOff : Pin;

  return (
    <div>
      <div className="group/node relative flex min-w-0 items-center py-0.5 text-sm">
        <button
          className={`flex h-8 w-5 shrink-0 items-center justify-center rounded-md text-jelly-text-muted transition-colors ${isFolder ? "cursor-pointer hover:text-jelly-text" : ""}`}
          style={{ marginLeft: `${depth * 14}px` }}
          onClick={() => {
            if (isFolder) {
              toggleFolder(node.id);
            }
          }}
        >
          {isFolder ? (
            <ChevronRight
              size={14}
              className={`transition-transform duration-200 ${isExpanded ? "rotate-90" : ""} ${hasChildren ? "" : "opacity-0"}`}
            />
          ) : null}
        </button>

        <button
          className={`flex min-h-8 flex-1 items-center gap-2 overflow-hidden rounded-md border px-2 text-left transition-all duration-150 ${isSelected
            ? "border-transparent bg-transparent text-jelly-blue-deep shadow-none"
            : "border-transparent text-jelly-text-soft hover:bg-white hover:text-jelly-text"
            }`}
          onClick={() => {
            if (isFolder) {
              toggleFolder(node.id);
            } else {
              setSelectedFileId(node.id);
              onFileOpen?.();
            }
          }}
        >
          {isFolder ? (
            isExpanded ? (
              <FolderOpen size={16} className="text-jelly-blue shrink-0" strokeWidth={1.6} />
            ) : (
              <Folder size={16} className="text-jelly-blue shrink-0" strokeWidth={1.6} />
            )
          ) : (
            <FileText size={16} className="text-jelly-text-muted shrink-0" strokeWidth={1.6} />
          )}
          {node.pinned && <Pin size={12} className="shrink-0 text-jelly-blue-deep" strokeWidth={1.8} />}
          {node.favorite && <Star size={12} className="shrink-0 text-jelly-amber" fill="currentColor" strokeWidth={1.8} />}
          {isRenaming ? (
            <input
              value={renameDraft}
              autoFocus
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onCommitRename(node);
                if (event.key === "Escape") onCancelRename();
              }}
              onBlur={() => onCommitRename(node)}
              className="min-w-0 flex-1 rounded-sm border border-jelly-blue/40 bg-white px-1.5 py-1 text-[13px] leading-none text-jelly-text outline-none"
            />
          ) : (
            <span className="truncate text-[13px] leading-none">{node.name.replace(/\.md$/, "")}</span>
          )}
        </button>

        <div className="relative ml-1 shrink-0">
          <button
            type="button"
            className={`flex h-7 w-7 items-center justify-center rounded-md text-jelly-text-muted transition-all hover:bg-white hover:text-jelly-text ${
              menuOpen ? "bg-white opacity-100" : "opacity-0 group-hover/node:opacity-100"
            }`}
            onClick={(event) => {
              event.stopPropagation();
              onMenuChange(menuOpen ? null : node.id);
            }}
            aria-label="文件操作"
          >
            <MoreHorizontal size={15} strokeWidth={1.8} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md border border-jelly-border bg-white py-1 shadow-[0_14px_34px_rgba(22,34,45,0.14)]">
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
                onClick={(event) => {
                  event.stopPropagation();
                  onStartRename(node);
                }}
              >
                <Pencil size={14} strokeWidth={1.8} />
                重命名
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
                onClick={(event) => {
                  event.stopPropagation();
                  onStartMove(node);
                }}
              >
                <FolderInput size={14} strokeWidth={1.8} />
                移动到
              </button>
              {!isFolder && (
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
                  onClick={(event) => {
                    event.stopPropagation();
                    onExport(node);
                  }}
                >
                  <Download size={14} strokeWidth={1.8} />
                  导出
                </button>
              )}
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-blue-pale hover:text-jelly-text"
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePin(node);
                }}
              >
                <PinIcon size={14} strokeWidth={1.8} />
                {node.pinned ? "取消置顶" : "置顶"}
              </button>
              {!isFolder && (
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-jelly-text-soft hover:bg-jelly-amber-bg hover:text-jelly-amber"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(node);
                  }}
                >
                  <Star size={14} fill={node.favorite ? "currentColor" : "none"} strokeWidth={1.8} />
                  {node.favorite ? "取消收藏" : "收藏"}
                </button>
              )}
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-rose-500 hover:bg-rose-50"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(node);
                }}
              >
                <Trash2 size={14} strokeWidth={1.8} />
                删除
              </button>
            </div>
          )}
        </div>
      </div>

      {isFolder && isExpanded && (
        <div>
          {hasChildren ? (
            sortPinnedFirst(node.children!).map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                autoExpand={autoExpand}
                renamingId={renamingId}
                renameDraft={renameDraft}
                menuNodeId={menuNodeId}
                onRenameDraftChange={onRenameDraftChange}
                onStartRename={onStartRename}
                onCommitRename={onCommitRename}
                onCancelRename={onCancelRename}
                onStartMove={onStartMove}
                onExport={onExport}
                onDelete={onDelete}
                onTogglePin={onTogglePin}
                onToggleFavorite={onToggleFavorite}
                onMenuChange={onMenuChange}
                onFileOpen={onFileOpen}
              />
            ))
          ) : (
            <div
              className="flex items-center gap-1.5 py-2 text-[12px] text-jelly-text-muted"
              style={{ paddingLeft: `${34 + depth * 14}px` }}
            >
              <Plus size={12} strokeWidth={1.8} />
              <span>暂无笔记</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type DirectoryTreeProps = {
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onFileOpen?: () => void;
} & Pick<AccountMenuProps, "themeMode" | "onThemeModeChange" | "userEmail" | "userName" | "onSignOut">;

export default function DirectoryTree({
  pinned,
  onPinnedChange,
  themeMode,
  onThemeModeChange,
  userEmail,
  userName,
  onSignOut,
  onFileOpen,
}: DirectoryTreeProps) {
  const {
    treeData,
    selectedFileId,
    setSelectedFileId,
    fileContents,
    addNode,
    updateNodeName,
    deleteNode,
    moveNode,
    toggleNodePinned,
    toggleNodeFavorite,
    deletedNotes,
    restoreDeletedNote,
  } = useWorkspaceSlice();
  const { focusChatSource } = useEditorSlice();
  const [searchQuery, setSearchQuery] = useState("");
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newTooltipOpen, setNewTooltipOpen] = useState(false);
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [movingNode, setMovingNode] = useState<FileNode | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string>("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTargetState | null>(null);
  const [searchResults, setSearchResults] = useState<ChatSource[]>([]);
  const [searchPlan, setSearchPlan] = useState<NoteSearchQueryPlan | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [libraryView, setLibraryView] = useState<LibraryView>("all");
  const [activeTag, setActiveTag] = useState("");
  const newMenuRef = useRef<HTMLDivElement>(null);
  const deleteConfirmRef = useRef<HTMLDivElement>(null);
  const expanded = pinned;

  const metadataFilteredTree = useMemo(
    () => filterTreeByMetadata(treeData, libraryView, activeTag),
    [activeTag, libraryView, treeData]
  );
  const filteredTree = useMemo(
    () => sortPinnedFirst(filterTree(metadataFilteredTree, searchQuery)),
    [metadataFilteredTree, searchQuery]
  );
  const isSearching = searchQuery.length > 0;
  const fileCount = useMemo(() => countFiles(treeData), [treeData]);
  const folderCount = useMemo(() => countFolders(treeData), [treeData]);
  const filePaths = useMemo(() => collectFilePaths(treeData), [treeData]);
  const availableTags = useMemo(() => collectTags(treeData), [treeData]);
  const moveTargets = useMemo(() => {
    const excludeIds =
      movingNode?.type === "folder" ? collectFolderIds(movingNode) : new Set<string>();
    return [{ id: null, label: "知识库根目录" }, ...flattenFolders(treeData, excludeIds)];
  }, [movingNode, treeData]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setNewMenuOpen(false);
      }
    }
    if (newMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [newMenuOpen]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchPlan(null);
      setSearchLoading(false);
      setSearchError("");
      return;
    }

    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      void searchNotes(query, { limit: 16, signal: controller.signal })
        .then((response) => {
          setSearchResults(response.results);
          setSearchPlan(response.query);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setSearchResults([]);
          setSearchPlan(null);
          setSearchError(error instanceof Error ? error.message : "搜索失败，请稍后重试");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
    }, 260);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!deleteTarget) return;

    function handlePointerDown(event: MouseEvent) {
      if (deleteConfirmRef.current?.contains(event.target as Node)) return;
      setDeleteTarget(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDeleteTarget(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteTarget]);

  useEffect(() => {
    if (expanded) return;
    setNewMenuOpen(false);
    setMenuNodeId(null);
    setRenamingId(null);
    setMovingNode(null);
    setTrashOpen(false);
    setDeleteTarget(null);
    setSearchQuery("");
    setNewTooltipOpen(false);
  }, [expanded]);

  const handleNewFile = useCallback(() => {
    const id = generateId();
    const parentId = selectedFileId
      ? findParentFolderId(treeData, selectedFileId)
      : null;
    addNode(parentId, {
      id,
      name: "未命名笔记.md",
      type: "file",
      content: "",
    });
    setSelectedFileId(id);
    setNewTooltipOpen(false);
    setNewMenuOpen(false);
  }, [selectedFileId, treeData, addNode, setSelectedFileId]);

  const handleNewFolder = useCallback(() => {
    const id = generateId();
    const parentId = selectedFileId
      ? findParentFolderId(treeData, selectedFileId)
      : null;
    addNode(parentId, {
      id,
      name: "新建文件夹",
      type: "folder",
      children: [],
    });
    setRenamingId(id);
    setRenameDraft("新建文件夹");
    setNewTooltipOpen(false);
    setNewMenuOpen(false);
  }, [selectedFileId, treeData, addNode]);

  const handleStartRename = useCallback((node: FileNode) => {
    setMenuNodeId(null);
    setDeleteTarget(null);
    setRenamingId(node.id);
    setRenameDraft(node.name.replace(/\.md$/, ""));
  }, []);

  const handleCommitRename = useCallback(
    (node: FileNode) => {
      if (renamingId !== node.id) return;
      const nextName = normalizeNodeName(node, renameDraft);
      updateNodeName(node.id, nextName);
      setRenamingId(null);
      setRenameDraft("");
    },
    [renameDraft, renamingId, updateNodeName]
  );

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameDraft("");
  }, []);

  const handleStartMove = useCallback((node: FileNode) => {
    setMenuNodeId(null);
    setDeleteTarget(null);
    setMovingNode(node);
    setMoveTargetId("");
  }, []);

  const handleMoveConfirm = useCallback(() => {
    if (!movingNode) return;
    moveNode(movingNode.id, moveTargetId || null);
    setMovingNode(null);
    setMoveTargetId("");
  }, [moveNode, moveTargetId, movingNode]);

  const handleExport = useCallback(
    (node: FileNode) => {
      if (node.type !== "file") return;
      setMenuNodeId(null);
      setDeleteTarget(null);

      const fileName = node.name.endsWith(".md") ? node.name : `${node.name}.md`;
      const content = fileContents[node.id] ?? node.content ?? "";
      const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    [fileContents]
  );

  const handleDelete = useCallback(
    (node: FileNode) => {
      setMenuNodeId(null);
      setMovingNode(null);
      setDeleteTarget({ node });
    },
    []
  );

  const confirmDeleteTarget = useCallback(() => {
    if (!deleteTarget) return;
    deleteNode(deleteTarget.node.id);
    setDeleteTarget(null);
  }, [deleteNode, deleteTarget]);

  const cancelDeleteTarget = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const deleteTargetNode = deleteTarget?.node ?? null;
  const deleteTargetLabel = deleteTargetNode?.type === "folder" ? "文件夹" : "笔记";
  const deleteTargetDetail =
    deleteTargetNode?.type === "folder"
      ? "文件夹内的所有子文件和内容也会一起删除。"
      : "这篇笔记的正文内容也会一起删除。";

  const handleTogglePin = useCallback(
    (node: FileNode) => {
      setMenuNodeId(null);
      setDeleteTarget(null);
      toggleNodePinned(node.id);
    },
    [toggleNodePinned]
  );

  const handleToggleFavorite = useCallback(
    (node: FileNode) => {
      setMenuNodeId(null);
      setDeleteTarget(null);
      toggleNodeFavorite(node.id);
    },
    [toggleNodeFavorite]
  );

  return (
    <aside
      className={`directory-tree relative top-0 left-0 z-40 flex h-full flex-col border-r border-jelly-border bg-white/80 transition-[width,box-shadow] duration-200 ease-out ${
        expanded
          ? "w-[260px] shadow-none"
          : "w-[52px] shadow-none"
      }`}
    >
      {/* Header */}
      <div className={`shrink-0 ${expanded ? "px-5 pb-4 pt-6" : "px-2 py-3"}`}>
        {expanded ? (
          <>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="-ml-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-jelly-text">
                  <BookOpen size={17} className="text-jelly-blue-deep" strokeWidth={1.8} />
                  <h1 className="truncate text-[15px] font-semibold">目录</h1>
                </div>
                <p className="mt-1 text-[12px] text-jelly-text-muted">
                  {fileCount} 篇笔记 · {folderCount} 个文件夹
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                    expanded
                      ? "bg-jelly-blue-pale text-jelly-blue-deep"
                      : "text-jelly-text-soft hover:bg-white hover:text-jelly-text"
                  }`}
                  onClick={() => onPinnedChange(!pinned)}
                  aria-label="收起知识库"
                  title="收起知识库"
                >
                  <ChevronsLeft size={15} strokeWidth={1.8} />
                </button>
                <div
                  className="relative"
                  ref={newMenuRef}
                  onMouseEnter={() => setNewTooltipOpen(true)}
                  onMouseLeave={() => setNewTooltipOpen(false)}
                >
                  <button
                    className="flex h-8 w-8 items-center justify-center rounded-md text-jelly-text-soft transition-colors hover:bg-white hover:text-jelly-text"
                    onClick={() => {
                      setNewTooltipOpen(false);
                      setNewMenuOpen((v) => !v);
                    }}
                    aria-label="新建"
                  >
                    <Plus size={16} strokeWidth={2} />
                  </button>
                  <span
                    className={`pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-jelly-border bg-white px-2.5 py-1 text-[12px] font-medium text-jelly-text-soft shadow-[0_6px_18px_rgba(30,44,56,0.08)] transition-all duration-150 ${
                      newTooltipOpen && !newMenuOpen
                        ? "translate-y-0 opacity-100"
                        : "-translate-y-1 opacity-0"
                    }`}
                  >
                    新建
                  </span>
                  {newMenuOpen && (
                    <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border border-jelly-border bg-white py-1 shadow-lg">
                      <button
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-jelly-text-soft transition-colors hover:bg-jelly-blue-pale hover:text-jelly-text"
                        onClick={handleNewFile}
                      >
                        <FilePlus size={15} strokeWidth={1.8} />
                        新建笔记
                      </button>
                      <button
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-jelly-text-soft transition-colors hover:bg-jelly-blue-pale hover:text-jelly-text"
                        onClick={handleNewFolder}
                      >
                        <FolderPlus size={15} strokeWidth={1.8} />
                        新建文件夹
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="ui-input flex items-center gap-2 px-2.5 shadow-none">
              <Search size={14} className="shrink-0 text-jelly-text-muted" strokeWidth={1.8} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索笔记"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-jelly-text outline-none placeholder:text-jelly-text-muted"
              />
              {searchQuery && (
                <button
                  className="shrink-0 rounded-sm text-jelly-text-muted transition-colors hover:text-jelly-text"
                  onClick={() => setSearchQuery("")}
                  aria-label="清空搜索"
                >
                  <X size={14} strokeWidth={2} />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-md text-jelly-text-soft transition-colors hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
              onClick={() => onPinnedChange(true)}
              aria-label="展开知识库"
              title="展开知识库"
            >
              <ChevronsRight size={14} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      {/* Tree */}
      <div className={`flex-1 overflow-y-auto ${expanded ? "px-4 py-2" : "px-2 py-3"}`}>
        {expanded && isSearching ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <span className="text-[12px] font-medium text-jelly-text-soft">
                {searchLoading ? "正在检索知识库" : `${searchResults.length} 条相关结果`}
              </span>
              {searchLoading && <Loader2 size={13} className="animate-spin text-jelly-blue-deep" />}
            </div>
            {searchPlan?.searchQuery && searchPlan.searchQuery !== searchQuery.trim() && (
              <p className="mb-2 truncate px-1 text-[11px] text-jelly-text-muted" title={searchPlan.searchQuery}>
                检索词：{searchPlan.searchQuery}
              </p>
            )}

            {searchError ? (
              <div className="rounded-lg border border-jelly-red/25 bg-jelly-red-bg px-3 py-3 text-[12px] leading-5 text-jelly-red">
                {searchError}
              </div>
            ) : searchLoading && searchResults.length === 0 ? (
              <div className="empty-state flex flex-col items-center justify-center py-10">
                <Loader2 size={20} className="mb-2 animate-spin text-jelly-blue-deep" />
                <p className="text-[12px]">正在搜索标题、小节和正文</p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="empty-state flex flex-col items-center justify-center px-3 py-10 text-center">
                <Search size={20} strokeWidth={1.2} className="mb-2 opacity-40" />
                <p className="text-[12px] font-medium text-jelly-text-soft">未找到相关内容</p>
                <p className="mt-1 text-[11px] leading-5 text-jelly-text-muted">试试更具体的关键词或问题</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {searchResults.map((result, index) => (
                  <button
                    key={`${result.noteId}-${result.sectionId ?? "note"}-${result.chunkId ?? index}`}
                    type="button"
                    className="group w-full rounded-lg border border-transparent px-2.5 py-2.5 text-left transition-colors hover:border-jelly-border hover:bg-white"
                    onClick={() => {
                      focusChatSource(result);
                      onFileOpen?.();
                    }}
                  >
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[13px] font-semibold text-jelly-text">
                        {result.noteTitle}
                      </span>
                      <span className="status-chip min-h-5 shrink-0 border-jelly-blue/15 bg-jelly-blue-pale px-1.5 py-0 text-[10px] text-jelly-blue-deep">
                        {searchChannelLabel(result)}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-jelly-text-muted">
                      {filePaths.get(result.noteId) ?? "知识库"}
                      {result.sectionTitle ? ` / ${result.sectionTitle}` : ""}
                    </span>
                    <span className="mt-1.5 line-clamp-3 block text-[12px] leading-5 text-jelly-text-soft">
                      {result.snippet || "打开查看命中内容"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : filteredTree.length === 0 ? (
          expanded ? (
            <div className="empty-state flex flex-col items-center justify-center py-10">
            <Search size={20} strokeWidth={1.2} className="opacity-30 mb-2" />
            <p className="text-[12px]">未找到匹配的笔记</p>
            </div>
          ) : null
        ) : (
          expanded ? (
            filteredTree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                autoExpand={isSearching}
                renamingId={renamingId}
                renameDraft={renameDraft}
                menuNodeId={menuNodeId}
                onRenameDraftChange={setRenameDraft}
                onStartRename={handleStartRename}
                onCommitRename={handleCommitRename}
                onCancelRename={handleCancelRename}
                onStartMove={handleStartMove}
                onExport={handleExport}
                onDelete={handleDelete}
                onTogglePin={handleTogglePin}
                onToggleFavorite={handleToggleFavorite}
                onMenuChange={setMenuNodeId}
                onFileOpen={onFileOpen}
              />
            ))
          ) : (
            <div className="space-y-1.5">
              {filteredTree.slice(0, 9).map((node) => (
                <button
                  key={node.id}
                  className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                    node.id === selectedFileId
                      ? "bg-jelly-blue-pale text-jelly-blue-deep"
                      : "text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-text"
                  }`}
                  onClick={() => {
                    if (node.type === "file") {
                      setSelectedFileId(node.id);
                      onFileOpen?.();
                    }
                  }}
                  title={node.name.replace(/\.md$/, "")}
                  aria-label={node.name.replace(/\.md$/, "")}
                >
                  {node.type === "folder" ? (
                    <Folder size={15} strokeWidth={1.6} />
                  ) : (
                    <FileText size={15} strokeWidth={1.6} />
                  )}
                </button>
              ))}
            </div>
          )
        )}
      </div>

      <div
        className={`border-t border-jelly-border bg-white/65 ${
          expanded ? "px-3 py-2" : "flex justify-center px-2 py-2"
        }`}
      >
        {expanded ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-8 min-w-0 flex-1 items-center justify-between rounded-md px-2 text-[12px] text-jelly-text-soft transition-colors hover:bg-white hover:text-jelly-text"
              onClick={() => setTrashOpen((open) => !open)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Trash2 size={14} className="shrink-0" strokeWidth={1.8} />
                <span className="truncate">回收站</span>
              </span>
              <span className="status-chip border-transparent bg-jelly-blue-pale text-jelly-blue-deep">
                {deletedNotes.length}
              </span>
            </button>
            <AccountMenu
              compact
              themeMode={themeMode}
              onThemeModeChange={onThemeModeChange}
              userEmail={userEmail}
              userName={userName}
              onSignOut={onSignOut}
            />
          </div>
        ) : (
          <AccountMenu
            compact
            themeMode={themeMode}
            onThemeModeChange={onThemeModeChange}
            userEmail={userEmail}
            userName={userName}
            onSignOut={onSignOut}
          />
        )}

          {expanded && trashOpen && (
            <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto">
              {deletedNotes.length === 0 ? (
                <p className="px-2 py-2 text-[12px] text-jelly-text-muted">暂无已删除笔记</p>
              ) : (
                deletedNotes.map((note) => (
                  <div
                    key={note.id}
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-jelly-text-soft hover:bg-white"
                  >
                    <FileText size={13} strokeWidth={1.7} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{note.title}</span>
                    <button
                      type="button"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-blue-deep"
                      onClick={() => restoreDeletedNote(note.id)}
                      aria-label={`恢复 ${note.title}`}
                      title="恢复"
                    >
                      <RotateCcw size={13} strokeWidth={1.8} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

      {movingNode && expanded && (
        <div className="border-t border-jelly-border bg-white px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="truncate text-[12px] font-semibold text-jelly-text">
              移动「{movingNode.name.replace(/\.md$/, "")}」
            </p>
            <button
              className="rounded-sm text-jelly-text-muted hover:text-jelly-text"
              onClick={() => setMovingNode(null)}
              aria-label="关闭移动面板"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          <select
            value={moveTargetId}
            onChange={(event) => setMoveTargetId(event.target.value)}
            className="ui-input h-9 w-full px-2 text-[13px] outline-none"
          >
            {moveTargets.map((target) => (
              <option key={target.id ?? "root"} value={target.id ?? ""}>
                {target.label}
              </option>
            ))}
          </select>
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="ui-button ui-button-secondary h-9 px-3"
              onClick={() => setMovingNode(null)}
            >
              取消
            </button>
            <button
              className="ui-button ui-button-primary h-9 px-3"
              onClick={handleMoveConfirm}
            >
              移动
            </button>
          </div>
        </div>
      )}

      {deleteTarget && deleteTargetNode && expanded && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/10 p-4 backdrop-blur-[1px]"
        >
          <div
            ref={deleteConfirmRef}
            className="panel-surface w-[min(420px,calc(100vw-32px))] border-jelly-red/20 p-5 shadow-[0_24px_70px_rgba(22,34,45,0.18)]"
            role="alertdialog"
            aria-modal="true"
            aria-label={`删除${deleteTargetLabel}`}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-jelly-red-bg text-jelly-red">
                <Trash2 size={18} strokeWidth={1.9} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-6 text-jelly-text">
                  删除{deleteTargetLabel}「{deleteTargetNode.name.replace(/\.md$/, "")}」？
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-jelly-text-muted">
                  {deleteTargetDetail}
                </p>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-jelly-text-muted hover:bg-jelly-blue-pale hover:text-jelly-text"
                onClick={cancelDeleteTarget}
                aria-label="关闭删除确认"
              >
                <X size={15} strokeWidth={1.9} />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                className="ui-button ui-button-secondary h-9 px-4"
                onClick={cancelDeleteTarget}
              >
                取消
              </button>
              <button
                type="button"
                className="ui-button ui-button-danger h-9 px-4"
                onClick={confirmDeleteTarget}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function findParentFolderId(nodes: FileNode[], targetId: string): string | null {
  for (const node of nodes) {
    if (node.type === "folder" && node.children) {
      for (const child of node.children) {
        if (child.id === targetId) return node.id;
      }
      const found = findParentFolderId(node.children, targetId);
      if (found) return found;
    }
  }
  return null;
}
