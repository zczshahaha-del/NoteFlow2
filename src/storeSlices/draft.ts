import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "../store";

export function useDraftSlice() {
  return useAppStore(useShallow((state) => ({
    centerMode: state.centerMode,
    draftSeed: state.draftSeed,
    draftCommand: state.draftCommand,
    activeDraftContext: state.activeDraftContext,
    pendingCheckpoint: state.pendingCheckpoint,
    startDraft: state.startDraft,
    openPendingDraft: state.openPendingDraft,
    openPendingEditPreview: state.openPendingEditPreview,
    setActiveDraftContext: state.setActiveDraftContext,
    requestDraftCommand: state.requestDraftCommand,
    consumeDraftCommand: state.consumeDraftCommand,
    closeDraft: state.closeDraft,
  })));
}
