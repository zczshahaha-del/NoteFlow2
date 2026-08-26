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
  Star,
  Check,
} from "lucide-react";
import { generateId } from "../store";
import { useEditorSlice, useWorkspaceSlice } from "../store/selectors";
import type { ChatSource, FileNode } from "../types";
import AccountMenu, { type AccountMenuProps } from "./AppNav";
import LibrarySearchDialog from "./LibrarySearchDialog";

function countFiles(nodes: FileNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.type === "file") return total + 1;
    return total + countFiles(node.children ?? []);
  }, 0);
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
  parents: string[] = []
): Array<{ id: string; name: string; path: string; depth: number }> {
  const folders: Array<{ id: string; name: string; path: string; depth: number }> = [];
  for (const node of nodes) {
    if (node.type !== "folder" || excludeIds.has(node.id)) continue;
    const pathParts = [...parents, node.name];
    folders.push({
      id: node.id,
      name: node.name,
      path: pathParts.join(" / "),
      depth: parents.length,
    });
    folders.push(...flattenFolders(node.children ?? [], excludeIds, pathParts));
  }
  return folders;
}

type FolderTarget = {
  id: string | null;
  name: string;
  path: string;
  depth: number;
};

function FolderPicker({
  targets,
  value,
  currentId,
  query,
  onQueryChange,
  onChange,
}: {
  targets: FolderTarget[];
  value: string | null;
  currentId?: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onChange: (value: string | null) => void;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleTargets = normalizedQuery
    ? targets.filter((target) => target.path.toLocaleLowerCase().includes(normalizedQuery))
    : targets;

  return (
    <div>
      <div className="ui-input mb-3 flex h-10 items-center gap-2 px-3 shadow-none">
        <Search size={14} className="shrink-0 text-jelly-text-muted" strokeWidth={1.8} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索文件夹"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-jelly-text outline-none placeholder:text-jelly-text-muted"
        />
        {query && (
          <button
            type="button"
            className="text-jelly-text-muted transition-colors hover:text-jelly-text"
            onClick={() => onQueryChange("")}
            aria-label="清空文件夹搜索"
          >
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {visibleTargets.length === 0 ? (
          <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-jelly-border text-center">
            <Folder size={19} className="text-jelly-text-muted" strokeWidth={1.5} />
            <p className="mt-2 text-[12px] text-jelly-text-muted">没有匹配的文件夹</p>
          </div>
        ) : (
          visibleTargets.map((target) => {
            const selected = value === target.id;
            const current = currentId !== undefined && currentId === target.id;
            return (
              <button
                key={target.id ?? "root"}
                type="button"
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all ${
                  selected
                    ? "border-jelly-blue/35 bg-jelly-blue-pale text-jelly-blue-deep"
                    : "border-transparent text-jelly-text-soft hover:border-jelly-border hover:bg-white"
                }`}
                style={{ paddingLeft: `${12 + Math.min(target.depth, 4) * 10}px` }}
                onClick={() => onChange(target.id)}
                aria-pressed={selected}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    selected ? "bg-white/80 text-jelly-blue-deep" : "bg-jelly-blue-pale text-jelly-blue"
                  }`}
                >
                  {target.id === null
                    ? <BookOpen size={16} strokeWidth={1.7} />
                    : <Folder size={16} strokeWidth={1.7} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-jelly-text">
                      {target.name}
                    </span>
                    {current && (
                      <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] text-jelly-text-muted">
                        当前位置
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-jelly-text-muted">
                    {target.path}
                  </span>
                </span>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    selected
                      ? "border-jelly-blue-deep bg-jelly-blue-deep text-white"
                      : "border-jelly-border bg-white text-transparent"
                  }`}
                >
                  <Check size={12} strokeWidth={2.2} />
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
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
        {isFolder && hasChildren ? (
          <button
            type="button"
            className="flex h-8 w-5 shrink-0 items-center justify-center rounded-md text-jelly-text-muted transition-colors hover:text-jelly-blue-deep focus-visible:text-jelly-blue-deep"
            style={{ marginLeft: `${depth * 12}px` }}
            onClick={() => toggleFolder(node.id)}
            aria-label={isExpanded ? `收起${node.name}` : `展开${node.name}`}
          >
            <ChevronRight
              size={14}
              className={`transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span
            className="h-8 w-5 shrink-0"
            style={{ marginLeft: `${depth * 12}px` }}
            aria-hidden="true"
          />
        )}

        <button
          type="button"
          className={`relative flex min-h-8 flex-1 items-center gap-2 overflow-hidden rounded-md border px-2 text-left transition-all duration-150 ${isSelected
            ? "border-transparent bg-jelly-blue-pale font-medium text-jelly-blue-deep shadow-none"
            : "border-transparent text-jelly-text-soft hover:bg-jelly-blue-pale/60 hover:text-jelly-text focus-visible:bg-jelly-blue-pale/60 focus-visible:text-jelly-blue-deep"
            }`}
          onClick={() => {
            if (isFolder) {
              toggleFolder(node.id);
            } else {
              setSelectedFileId(node.id);
              onFileOpen?.();
            }
          }}
          aria-expanded={isFolder ? isExpanded : undefined}
          aria-current={isSelected ? "page" : undefined}
        >
          {isSelected && (
            <span
              className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-jelly-blue"
              aria-hidden="true"
            />
          )}
          {isFolder ? (
            isExpanded ? (
              <FolderOpen
                size={16}
                className="shrink-0 text-jelly-text-muted transition-colors group-hover/node:text-jelly-blue"
                strokeWidth={1.6}
              />
            ) : (
              <Folder
                size={16}
                className="shrink-0 text-jelly-text-muted transition-colors group-hover/node:text-jelly-blue"
                strokeWidth={1.6}
              />
            )
          ) : (
            <FileText
              size={16}
              className={`shrink-0 transition-colors ${
                isSelected
                  ? "text-jelly-blue-deep"
                  : "text-jelly-text-muted group-hover/node:text-jelly-blue"
              }`}
              strokeWidth={1.6}
            />
          )}
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
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[1.25]">
              {node.name.replace(/\.md$/, "")}
            </span>
          )}
          {node.pinned && (
            <Pin size={12} className="shrink-0 text-jelly-text-muted" strokeWidth={1.8} aria-label="已置顶" />
          )}
          {node.favorite && (
            <Star
              size={12}
              className="shrink-0 text-jelly-amber"
              fill="currentColor"
              strokeWidth={1.8}
              aria-label="已收藏"
            />
          )}
        </button>

        <div className="relative ml-1 shrink-0" data-file-menu-root>
          <button
            type="button"
            className={`file-node-menu-button flex h-7 w-7 items-center justify-center rounded-md text-jelly-text-muted transition-all hover:bg-jelly-blue-pale hover:text-jelly-blue-deep focus-visible:bg-jelly-blue-pale focus-visible:text-jelly-blue-deep ${
              menuOpen
                ? "bg-jelly-blue-pale text-jelly-blue-deep opacity-100"
                : "opacity-0 group-hover/node:opacity-100 group-focus-within/node:opacity-100"
            }`}
            onClick={(event) => {
              event.stopPropagation();
              onMenuChange(menuOpen ? null : node.id);
            }}
            aria-label="文件操作"
            aria-expanded={menuOpen}
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
              style={{ paddingLeft: `${34 + depth * 12}px` }}
            >
              <FileText size={12} strokeWidth={1.7} aria-hidden="true" />
              <span>文件夹为空</span>
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
  searchShortcutEnabled?: boolean;
} & Pick<AccountMenuProps, "themeMode" | "onThemeModeChange" | "userEmail" | "userEmailVerified" | "userName" | "onEmailChanged" | "onSignOut">;

export default function DirectoryTree({
  pinned,
  onPinnedChange,
  themeMode,
  onThemeModeChange,
  userEmail,
  userEmailVerified,
  userName,
  onEmailChanged,
  onSignOut,
  onFileOpen,
  searchShortcutEnabled = true,
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newTooltipOpen, setNewTooltipOpen] = useState(false);
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [folderPickerQuery, setFolderPickerQuery] = useState("");
  const [movingNode, setMovingNode] = useState<FileNode | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTargetState | null>(null);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const deleteConfirmRef = useRef<HTMLDivElement>(null);
  const expanded = pinned;

  const filteredTree = useMemo(
    () => sortPinnedFirst(treeData),
    [treeData]
  );
  const fileCount = useMemo(() => countFiles(treeData), [treeData]);
  const moveTargets = useMemo(() => {
    const excludeIds =
      movingNode?.type === "folder" ? collectFolderIds(movingNode) : new Set<string>();
    return [
      { id: null, name: "知识库根目录", path: "知识库", depth: 0 },
      ...flattenFolders(treeData, excludeIds),
    ];
  }, [movingNode, treeData]);
  const allFolderTargets = useMemo(
    () => [
      { id: null, name: "知识库根目录", path: "知识库", depth: 0 },
      ...flattenFolders(treeData),
    ],
    [treeData]
  );
  const movingNodeParentId = useMemo(
    () => movingNode ? findParentFolderId(treeData, movingNode.id) : null,
    [movingNode, treeData]
  );

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
    if (!menuNodeId) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Element | null;
      if (typeof target?.closest === "function" && target.closest("[data-file-menu-root]")) return;
      setMenuNodeId(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuNodeId(null);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuNodeId]);

  useEffect(() => {
    if (!trashOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setTrashOpen(false);
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [trashOpen]);

  useEffect(() => {
    if (!newFolderOpen && !movingNode) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setNewFolderOpen(false);
      setMovingNode(null);
      setFolderPickerQuery("");
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [movingNode, newFolderOpen]);

  useEffect(() => {
    if (!searchShortcutEnabled) return;

    function handleSearchShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "k") return;
      event.preventDefault();
      setNewMenuOpen(false);
      setSearchOpen(true);
    }

    document.addEventListener("keydown", handleSearchShortcut);
    return () => document.removeEventListener("keydown", handleSearchShortcut);
  }, [searchShortcutEnabled]);

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
    setNewFolderOpen(false);
    setMovingNode(null);
    setTrashOpen(false);
    setDeleteTarget(null);
    setSearchOpen(false);
    setNewTooltipOpen(false);
    setFolderPickerQuery("");
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
    const parentId = selectedFileId
      ? findParentFolderId(treeData, selectedFileId)
      : null;
    setNewFolderName("");
    setNewFolderParentId(parentId);
    setFolderPickerQuery("");
    setNewFolderOpen(true);
    setNewTooltipOpen(false);
    setNewMenuOpen(false);
  }, [selectedFileId, treeData]);

  const handleCreateFolderConfirm = useCallback(() => {
    const name = newFolderName.trim().replace(/\.md$/i, "");
    if (!name) return;
    const id = generateId();
    addNode(newFolderParentId, {
      id,
      name,
      type: "folder",
      children: [],
    });
    setNewFolderOpen(false);
    setNewFolderName("");
    setFolderPickerQuery("");
  }, [addNode, newFolderName, newFolderParentId]);

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
    setMoveTargetId(findParentFolderId(treeData, node.id));
    setFolderPickerQuery("");
  }, [treeData]);

  const handleMoveConfirm = useCallback(() => {
    if (!movingNode) return;
    if (moveTargetId === movingNodeParentId) return;
    moveNode(movingNode.id, moveTargetId);
    setMovingNode(null);
    setMoveTargetId(null);
    setFolderPickerQuery("");
  }, [moveNode, moveTargetId, movingNode, movingNodeParentId]);

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

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
  }, []);

  const handleSearchSelect = useCallback(
    (source: ChatSource) => {
      focusChatSource(source);
      setSearchOpen(false);
      onFileOpen?.();
    },
    [focusChatSource, onFileOpen]
  );

  return (
    <aside
      className={`directory-tree relative top-0 left-0 z-40 flex h-full flex-col border-r border-jelly-border bg-white/80 transition-[width,box-shadow] duration-200 ease-out ${
        expanded
          ? "w-full shadow-none"
          : "w-[52px] shadow-none"
      }`}
    >
      {/* Header */}
      <div className={`shrink-0 ${expanded ? "px-4 pb-3 pt-5" : "px-2 py-3"}`}>
        {expanded ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-jelly-text">
                <BookOpen size={16} className="shrink-0 text-jelly-text-muted" strokeWidth={1.8} />
                <h1 className="shrink-0 text-[15px] font-semibold">目录</h1>
                <p className="min-w-0 truncate text-[11px] text-jelly-text-muted">
                  {fileCount} 篇
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <div className="group/collapse-directory relative">
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-jelly-text-muted transition-colors hover:bg-jelly-blue-pale hover:text-jelly-blue-deep focus-visible:bg-jelly-blue-pale focus-visible:text-jelly-blue-deep focus-visible:outline-none"
                    onClick={() => onPinnedChange(!pinned)}
                    aria-label="收起目录"
                    aria-describedby="collapse-directory-tooltip"
                  >
                    <ChevronsLeft size={15} strokeWidth={1.8} />
                  </button>
                  <span
                    id="collapse-directory-tooltip"
                    role="tooltip"
                    className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 -translate-y-1 whitespace-nowrap rounded-md border border-jelly-border bg-white px-2.5 py-1 text-[12px] font-medium text-jelly-text-soft opacity-0 shadow-[0_6px_18px_rgba(30,44,56,0.08)] transition-all duration-150 group-hover/collapse-directory:translate-y-0 group-hover/collapse-directory:opacity-100 group-focus-within/collapse-directory:translate-y-0 group-focus-within/collapse-directory:opacity-100"
                  >
                    收起目录
                  </span>
                </div>
                <div
                  className="relative"
                  ref={newMenuRef}
                  onMouseEnter={() => setNewTooltipOpen(true)}
                  onMouseLeave={() => setNewTooltipOpen(false)}
                >
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-jelly-text-muted transition-colors hover:bg-jelly-blue-pale hover:text-jelly-blue-deep focus-visible:bg-jelly-blue-pale focus-visible:text-jelly-blue-deep"
                    onClick={() => {
                      setNewTooltipOpen(false);
                      setNewMenuOpen((v) => !v);
                    }}
                    aria-label="新建"
                    aria-expanded={newMenuOpen}
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
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-jelly-text-muted transition-colors hover:bg-jelly-blue-pale hover:text-jelly-blue-deep focus-visible:bg-jelly-blue-pale focus-visible:text-jelly-blue-deep"
                  onClick={() => {
                    setNewMenuOpen(false);
                    setNewTooltipOpen(false);
                    setSearchOpen(true);
                  }}
                  aria-label="搜索全部笔记"
                  title="搜索全部笔记（⌘K）"
                >
                  <Search size={15} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md text-jelly-text-muted transition-colors hover:bg-jelly-blue-pale hover:text-jelly-blue-deep focus-visible:bg-jelly-blue-pale focus-visible:text-jelly-blue-deep"
              onClick={() => onPinnedChange(true)}
              aria-label="展开目录"
              title="展开目录"
            >
              <ChevronsRight size={14} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      {/* Tree */}
      <div className={`flex-1 overflow-y-auto ${expanded ? "px-4 py-2" : "px-2 py-3"}`}>
        {filteredTree.length === 0 ? (
          expanded ? (
            <div className="empty-state flex flex-col items-center justify-center px-4 py-9 text-center">
              <FilePlus size={21} strokeWidth={1.4} className="mb-2 text-jelly-text-muted" />
              <p className="text-[13px] font-medium text-jelly-text-soft">还没有笔记</p>
              <p className="mt-1 text-[11px] leading-5 text-jelly-text-muted">
                从第一篇内容开始建立你的知识库
              </p>
              <button
                type="button"
                className="mt-3 flex h-8 items-center gap-1.5 rounded-md border border-jelly-border bg-white px-3 text-[12px] font-medium text-jelly-text-soft transition-colors hover:border-jelly-blue/30 hover:bg-jelly-blue-pale hover:text-jelly-blue-deep focus-visible:bg-jelly-blue-pale focus-visible:text-jelly-blue-deep"
                onClick={handleNewFile}
              >
                <Plus size={13} strokeWidth={2} />
                新建第一篇笔记
              </button>
            </div>
          ) : null
        ) : (
          expanded ? (
            filteredTree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
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
          ) : null
        )}
      </div>

      <LibrarySearchDialog
        open={searchOpen}
        treeData={treeData}
        onClose={handleSearchClose}
        onSelect={handleSearchSelect}
      />

      <div className={`border-t border-jelly-border bg-white/65 ${expanded ? "px-3 py-2" : "flex justify-center px-2 py-2"}`}>
        <AccountMenu
          compact={!expanded}
          themeMode={themeMode}
          onThemeModeChange={onThemeModeChange}
          userEmail={userEmail}
          userEmailVerified={userEmailVerified}
          userName={userName}
          onEmailChanged={onEmailChanged}
          onSignOut={onSignOut}
          trashCount={deletedNotes.length}
          onOpenTrash={() => setTrashOpen(true)}
        />
      </div>

      {trashOpen && (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/15 p-4 backdrop-blur-[1px]"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setTrashOpen(false)}
            aria-label="关闭回收站"
          />
          <section
            className="panel-surface relative z-10 flex max-h-[min(680px,calc(100vh-32px))] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden shadow-[0_24px_70px_rgba(22,34,45,0.18)]"
            role="dialog"
            aria-modal="true"
            aria-label="回收站"
          >
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-jelly-border px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-jelly-blue-pale text-jelly-blue-deep">
                  <Trash2 size={18} strokeWidth={1.8} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[16px] font-semibold text-jelly-text">回收站</h2>
                  <p className="mt-0.5 text-[12px] text-jelly-text-muted">
                    {deletedNotes.length > 0
                      ? `${deletedNotes.length} 篇已删除笔记`
                      : "没有已删除的笔记"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-jelly-text-muted transition-colors hover:bg-jelly-blue-pale hover:text-jelly-text"
                onClick={() => setTrashOpen(false)}
                aria-label="关闭回收站"
              >
                <X size={16} strokeWidth={1.9} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {deletedNotes.length === 0 ? (
                <div className="flex min-h-44 flex-col items-center justify-center px-6 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-jelly-blue-pale text-jelly-blue-deep">
                    <Trash2 size={20} strokeWidth={1.6} />
                  </div>
                  <p className="mt-3 text-[14px] font-medium text-jelly-text">回收站是空的</p>
                  <p className="mt-1 text-[12px] text-jelly-text-muted">
                    删除的笔记会集中显示在这里
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {deletedNotes.map((note) => (
                    <div
                      key={note.id}
                      className="flex min-w-0 items-center gap-3 rounded-lg border border-jelly-border bg-white px-3.5 py-3"
                    >
                      <FileText
                        size={17}
                        strokeWidth={1.7}
                        className="shrink-0 text-jelly-text-muted"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-jelly-text">
                          {note.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-jelly-text-muted">已移至回收站</p>
                      </div>
                      <button
                        type="button"
                        className="ui-button ui-button-secondary h-8 shrink-0 gap-1.5 px-3 text-[12px]"
                        onClick={() => restoreDeletedNote(note.id)}
                        aria-label={`恢复 ${note.title}`}
                      >
                        <RotateCcw size={13} strokeWidth={1.8} />
                        恢复
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {newFolderOpen && expanded && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-[#26343d]/20 p-4 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => {
              setNewFolderOpen(false);
              setFolderPickerQuery("");
            }}
            aria-label="关闭新建文件夹"
          />
          <section
            className="panel-surface relative z-10 flex max-h-[min(720px,calc(100vh-32px))] w-[min(520px,calc(100vw-32px))] flex-col overflow-hidden shadow-[0_28px_80px_rgba(22,34,45,0.22)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-folder-title"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-jelly-border px-6 py-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jelly-blue-pale text-jelly-blue-deep">
                  <FolderPlus size={19} strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <h2 id="new-folder-title" className="text-[16px] font-semibold text-jelly-text">
                    新建文件夹
                  </h2>
                  <p className="mt-1 text-[12px] leading-5 text-jelly-text-muted">
                    给知识内容一个清晰的位置，确认后才会创建。
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-jelly-text-muted transition-colors hover:bg-jelly-blue-pale hover:text-jelly-text"
                onClick={() => {
                  setNewFolderOpen(false);
                  setFolderPickerQuery("");
                }}
                aria-label="关闭新建文件夹"
              >
                <X size={16} strokeWidth={1.9} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <label className="mb-2 block text-[12px] font-medium text-jelly-text-soft" htmlFor="new-folder-name">
                文件夹名称
              </label>
              <div className="ui-input flex h-11 items-center gap-2.5 px-3.5 shadow-none">
                <Folder size={16} className="shrink-0 text-jelly-blue" strokeWidth={1.7} />
                <input
                  id="new-folder-name"
                  value={newFolderName}
                  autoFocus
                  maxLength={120}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newFolderName.trim()) {
                      handleCreateFolderConfirm();
                    }
                  }}
                  placeholder="例如：后端开发"
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-jelly-text outline-none placeholder:text-jelly-text-muted"
                />
                <span className="text-[11px] text-jelly-text-muted">{newFolderName.trim().length}/120</span>
              </div>

              <div className="mb-2 mt-5 flex items-center justify-between gap-3">
                <p className="text-[12px] font-medium text-jelly-text-soft">创建位置</p>
                <p className="truncate text-[11px] text-jelly-text-muted">
                  {allFolderTargets.find((target) => target.id === newFolderParentId)?.path ?? "知识库"}
                </p>
              </div>
              <FolderPicker
                targets={allFolderTargets}
                value={newFolderParentId}
                query={folderPickerQuery}
                onQueryChange={setFolderPickerQuery}
                onChange={setNewFolderParentId}
              />
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-jelly-border bg-white/70 px-6 py-4">
              <p className="min-w-0 truncate text-[11px] text-jelly-text-muted">
                创建后仍可随时重命名或移动
              </p>
              <div className="flex shrink-0 gap-2.5">
                <button
                  type="button"
                  className="ui-button ui-button-secondary h-9 px-4"
                  onClick={() => {
                    setNewFolderOpen(false);
                    setFolderPickerQuery("");
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="ui-button ui-button-primary h-9 gap-1.5 px-4 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!newFolderName.trim()}
                  onClick={handleCreateFolderConfirm}
                >
                  <FolderPlus size={14} strokeWidth={1.9} />
                  创建文件夹
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {movingNode && expanded && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-[#26343d]/20 p-4 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => {
              setMovingNode(null);
              setFolderPickerQuery("");
            }}
            aria-label="关闭移动项目"
          />
          <section
            className="panel-surface relative z-10 flex max-h-[min(720px,calc(100vh-32px))] w-[min(520px,calc(100vw-32px))] flex-col overflow-hidden shadow-[0_28px_80px_rgba(22,34,45,0.22)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-item-title"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-jelly-border px-6 py-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jelly-blue-pale text-jelly-blue-deep">
                  <FolderInput size={19} strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <h2 id="move-item-title" className="text-[16px] font-semibold text-jelly-text">
                    移动{movingNode.type === "folder" ? "文件夹" : "笔记"}
                  </h2>
                  <p className="mt-1 max-w-[360px] truncate text-[12px] leading-5 text-jelly-text-muted">
                    「{movingNode.name.replace(/\.md$/, "")}」
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-jelly-text-muted transition-colors hover:bg-jelly-blue-pale hover:text-jelly-text"
                onClick={() => {
                  setMovingNode(null);
                  setFolderPickerQuery("");
                }}
                aria-label="关闭移动项目"
              >
                <X size={16} strokeWidth={1.9} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="mb-3 rounded-xl border border-jelly-border bg-jelly-blue-pale/45 px-3.5 py-3">
                <div className="flex items-center gap-3">
                  {movingNode.type === "folder"
                    ? <Folder size={17} className="shrink-0 text-jelly-blue" strokeWidth={1.7} />
                    : <FileText size={17} className="shrink-0 text-jelly-text-muted" strokeWidth={1.7} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-jelly-text">
                      {movingNode.name.replace(/\.md$/, "")}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-jelly-text-muted">
                      当前：{moveTargets.find((target) => target.id === movingNodeParentId)?.path ?? "知识库"}
                    </p>
                  </div>
                </div>
              </div>
              <p className="mb-2 text-[12px] font-medium text-jelly-text-soft">选择目标位置</p>
              <FolderPicker
                targets={moveTargets}
                value={moveTargetId}
                currentId={movingNodeParentId}
                query={folderPickerQuery}
                onQueryChange={setFolderPickerQuery}
                onChange={setMoveTargetId}
              />
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-jelly-border bg-white/70 px-6 py-4">
              <p className="min-w-0 truncate text-[11px] text-jelly-text-muted">
                目标：{moveTargets.find((target) => target.id === moveTargetId)?.path ?? "知识库"}
              </p>
              <div className="flex shrink-0 gap-2.5">
                <button
                  type="button"
                  className="ui-button ui-button-secondary h-9 px-4"
                  onClick={() => {
                    setMovingNode(null);
                    setFolderPickerQuery("");
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="ui-button ui-button-primary h-9 gap-1.5 px-4 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={moveTargetId === movingNodeParentId}
                  onClick={handleMoveConfirm}
                >
                  <FolderInput size={14} strokeWidth={1.9} />
                  移动到这里
                </button>
              </div>
            </footer>
          </section>
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
