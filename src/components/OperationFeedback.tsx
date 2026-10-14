import type { ReactNode } from 'react';
import { useWorkspaceSlice } from '../store/selectors';
import './operation-feedback.css';

export function OperationFeedback({ children, onRetry, busy = false, retryLabel = '重试' }: {
  children: ReactNode; onRetry: () => void; busy?: boolean; retryLabel?: string;
}) {
  return <div className="nf-operation-feedback" role="alert">
    <div className="nf-operation-message">{children}</div>
    <button type="button" onClick={onRetry} disabled={busy}>{busy ? '重试中…' : retryLabel}</button>
  </div>;
}

export default function WorkspaceFeedback() {
  const { workspaceIssues = [], workspaceError, workspaceLoading, retryWorkspaceOperation, reloadWorkspace } = useWorkspaceSlice();
  if (!workspaceIssues.length && !workspaceError) return null;
  return <div className="nf-workspace-feedback" aria-label="知识库同步提示">
    {workspaceIssues.map(issue => <OperationFeedback key={issue.id} busy={issue.busy}
      onRetry={() => retryWorkspaceOperation(issue.id)}>
      <strong>{issue.label}未同步</strong><span>{issue.message}</span>
    </OperationFeedback>)}
    {!workspaceIssues.length && workspaceError && <OperationFeedback busy={workspaceLoading}
      retryLabel="重新读取" onRetry={() => reloadWorkspace()}>{workspaceError}</OperationFeedback>}
  </div>;
}
