import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "..";
import { createNavigationTreeSelector } from "../navigationTree";
import { findFileById } from "../../workspaceTree";

const navigationTree = createNavigationTreeSelector();

// Subscribe at surface boundaries: an editor keystroke is not a chat, library
// or application-shell update. Read export content at action time instead.
export function useChatSelection() {
  return useAppStore(state => state.chatSelection);
}

export function useAIContextSlice() {
  return useAppStore(useShallow(state => ({
    selectedFileId: state.selectedFileId,
    treeData: navigationTree(state.treeData),
    reloadWorkspace: state.reloadWorkspace,
    activeEditPreview: state.activeEditPreview,
    createEditPreviewRequest: state.createEditPreviewRequest,
    applyEditPreviewRequest: state.applyEditPreviewRequest,
    cancelEditPreviewRequest: state.cancelEditPreviewRequest,
    focusChatSource: state.focusChatSource,
  })));
}

export function useDirectoryRowSlice() {
  return useAppStore(useShallow(state => ({
    selectedFileId: state.selectedFileId,
    setSelectedFileId: state.setSelectedFileId,
    expandedFolderIds: state.expandedFolderIds,
    toggleFolder: state.toggleFolder,
  })));
}

export function useDirectorySlice() {
  return useAppStore(useShallow(state => ({
    treeData: navigationTree(state.treeData),
    selectedFileId: state.selectedFileId,
    setSelectedFileId: state.setSelectedFileId,
    addNode: state.addNode,
    updateNodeName: state.updateNodeName,
    deleteNode: state.deleteNode,
    moveNode: state.moveNode,
    toggleNodePinned: state.toggleNodePinned,
    toggleNodeFavorite: state.toggleNodeFavorite,
    deletedNotes: state.deletedNotes,
    focusChatSource: state.focusChatSource,
  })));
}

export function readWorkspaceFileContent(id: string): string | undefined {
  const state = useAppStore.getState();
  return state.fileContents[id] ?? findFileById(state.treeData, id)?.content;
}
