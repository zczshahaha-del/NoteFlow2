import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "..";
import { draftConversationIndex } from "../../utils/aiWritingFlow";

export function useDraftSlice() {
  return useAppStore(useShallow((state) => ({
    centerMode: state.centerMode,
    draftSeed: state.draftSeed,
    draftCommand: state.draftCommand,
    activeDraftContext: state.activeDraftContext,
    pendingCheckpoint: state.pendingCheckpoint,
    startDraft: state.startDraft,
    openPendingDraft: state.openPendingDraft,
    dismissDraftWorkspace: state.dismissDraftWorkspace,
    openPendingEditPreview: state.openPendingEditPreview,
    setActiveDraftContext: state.setActiveDraftContext,
    requestDraftCommand: state.requestDraftCommand,
    editDraftBrief: state.editDraftBrief,
    generateDraftBrief: state.generateDraftBrief,
    draftBriefApprovalRequired: Boolean(state.pendingCheckpoint?.checkpointType === "draft_workspace" || state.chatMessages[draftConversationIndex(state.chatMessages, {
      checkpointId: state.pendingCheckpoint?.checkpointType === "draft_workspace" ? state.pendingCheckpoint.id : null,
      draftId: state.activeDraftContext?.id, seed: state.draftSeed,
    })]?.draftCard),
    consumeDraftCommand: state.consumeDraftCommand,
    closeDraft: state.closeDraft,
  })));
}
