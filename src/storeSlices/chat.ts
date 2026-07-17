import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "../store";

export function useChatSlice() {
  return useAppStore(useShallow((state) => ({
    chatMessages: state.chatMessages,
    chatLoading: state.chatLoading,
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
