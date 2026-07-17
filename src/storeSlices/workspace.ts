import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "../store";

export function useWorkspaceSlice() {
  return useAppStore(useShallow((state) => ({
    selectedFileId: state.selectedFileId,
    setSelectedFileId: state.setSelectedFileId,
    expandedFolderIds: state.expandedFolderIds,
    toggleFolder: state.toggleFolder,
    fileContents: state.fileContents,
    deletedNotes: state.deletedNotes,
    restoreDeletedNote: state.restoreDeletedNote,
    workspaceLoading: state.workspaceLoading,
    workspaceError: state.workspaceError,
    reloadWorkspace: state.reloadWorkspace,
    treeData: state.treeData,
    addNode: state.addNode,
    updateNodeName: state.updateNodeName,
    deleteNode: state.deleteNode,
    moveNode: state.moveNode,
    toggleNodePinned: state.toggleNodePinned,
    toggleNodeFavorite: state.toggleNodeFavorite,
    setNoteTags: state.setNoteTags,
  })));
}
