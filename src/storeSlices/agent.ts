import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "../store";

export function useAgentSlice() {
  return useAppStore(useShallow((state) => ({
    agentSessionId: state.agentSessionId,
    agentTask: state.agentTask,
    agentRunHistory: state.agentRunHistory,
    agentTaskDetailOpen: state.agentTaskDetailOpen,
    pendingCheckpoint: state.pendingCheckpoint,
    refreshAgentTask: state.refreshAgentTask,
    refreshAgentRunHistory: state.refreshAgentRunHistory,
    setAgentTaskDetailOpen: state.setAgentTaskDetailOpen,
    retryAgentTask: state.retryAgentTask,
  })));
}
