export interface KeyboardCompositionState {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export function shouldSubmitChatInput(
  event: KeyboardCompositionState,
  compositionActive: boolean
): boolean {
  if (compositionActive || event.isComposing || event.keyCode === 229) return false;
  return event.key === "Enter" && !event.shiftKey;
}
