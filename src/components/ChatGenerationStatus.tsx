/** A waiting label before response text arrives, not a provider reasoning event. */
export default function ChatGenerationStatus() {
  return (
    <div className="nf-chat-status" role="status" aria-live="polite" aria-atomic="true">
      <span className="nf-chat-status-dot" aria-hidden="true" />
      <span className="nf-chat-status-label">正在思考</span>
    </div>
  );
}
