/** A truthful activity indicator, not a claim about reasoning or tool progress. */
export default function ChatGenerationStatus({ streaming = false }: { streaming?: boolean }) {
  return (
    <div className="nf-chat-status" data-streaming={streaming} role="status" aria-live="polite" aria-atomic="true">
      <span className="nf-chat-status-dot" aria-hidden="true" />
      <span className="nf-chat-status-label">正在回复</span>
    </div>
  );
}
