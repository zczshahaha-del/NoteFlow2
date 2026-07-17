import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "../store";

export function useEditorSlice() {
  return useAppStore(useShallow((state) => ({
    centerMode: state.centerMode,
    selectedFileId: state.selectedFileId,
    treeData: state.treeData,
    fileContents: state.fileContents,
    updateFileContent: state.updateFileContent,
    noteSaveState: state.noteSaveState,
    updateNodeName: state.updateNodeName,
    reindexNote: state.reindexNote,
    restoreNoteVersion: state.restoreNoteVersion,
    activeEditPreview: state.activeEditPreview,
    createEditPreviewRequest: state.createEditPreviewRequest,
    reviseEditPreviewRequest: state.reviseEditPreviewRequest,
    restoreEditPreviewRevisionRequest: state.restoreEditPreviewRevisionRequest,
    applyEditPreviewRequest: state.applyEditPreviewRequest,
    cancelEditPreviewRequest: state.cancelEditPreviewRequest,
    closeEditPreview: state.closeEditPreview,
    pendingSourceFocus: state.pendingSourceFocus,
    pendingEditorSelection: state.pendingEditorSelection,
    activeEditorSectionId: state.activeEditorSectionId,
    focusChatSource: state.focusChatSource,
    clearPendingSourceFocus: state.clearPendingSourceFocus,
    clearPendingEditorSelection: state.clearPendingEditorSelection,
    setActiveEditorSectionId: state.setActiveEditorSectionId,
    addSelectionToChat: state.addSelectionToChat,
  })));
}
