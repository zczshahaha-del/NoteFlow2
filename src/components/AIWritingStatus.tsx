import "./ai-writing-status.css";

/** Shared, non-interactive stage summary. It never steals selection or focus. */
export default function AIWritingStatus({ label, hint, step, kind = "draft", compact = false, error = false }: {
  label: string;
  hint?: string;
  step: number;
  kind?: "draft" | "edit";
  compact?: boolean;
  error?: boolean;
}) {
  const steps = kind === "draft" ? ["确认大纲", "生成正文", "保存笔记"] : ["生成预览", "确认修改", "应用保存"];
  return (
    <div className={`nf-writing-status${compact ? " nf-writing-status-compact" : ""}`} data-kind={kind} data-error={error || undefined}>
      <p className="nf-writing-label" role="status">{label}</p>
      {!compact && <ol aria-label={kind === "draft" ? "草稿写作阶段" : "修改写作阶段"}>
        {steps.map((text, index) => <li key={text} aria-current={index === step ? "step" : undefined} data-complete={index < step || undefined}>{text}</li>)}
      </ol>}
      {hint && <p className="nf-writing-hint">{hint}</p>}
    </div>
  );
}
