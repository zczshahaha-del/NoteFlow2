import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "..";

export function useChatSlice() {
  return useAppStore(useShallow((state) => ({
    chatMessages: state.chatMessages,
    chatLoading: state.chatLoading,
    chatSessions: state.chatSessions,
    chatSessionsLoading: state.chatSessionsLoading,
    refreshChatSessions: state.refreshChatSessions,
    newChatSession: state.newChatSession,
    switchChatSession: state.switchChatSession,
    renameChatSession: state.renameChatSession,
    deleteChatSession: state.deleteChatSession,
    sendMessage: state.sendMessage,
    stopGeneration: state.stopGeneration,
    chatSelection: state.chatSelection,
    addSelectionToChat: state.addSelectionToChat,
    clearChatSelection: state.clearChatSelection,
    focusChatSource: state.focusChatSource,
    saveMemoryFromText: state.saveMemoryFromText,
    listMemoryRequest: state.listMemoryRequest,
  })));
}
