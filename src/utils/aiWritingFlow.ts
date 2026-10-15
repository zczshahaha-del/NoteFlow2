import type { ChatMessage } from "../types";

export type DraftWritingStage = "configuring" | "outline_ready" | "reviewing" | "generating" | "assembling" | "assembled" | "saving" | "failed";
export type DraftOutcome = { status: "resolved" | "cancelled"; draftId?: string };

export function draftWritingStage(status: string | undefined, busy: string, error: string, hasBody = false): DraftWritingStage {
  // An operation failure does not turn an existing body into a failed outline.
  if (busy === "save") return "saving";
  if (busy === "assemble") return "assembling";
  if (busy === "outline") return "configuring";
  if (busy === "section" || status === "generating") return "generating";
  if (status === "assembled" || status === "saved") return "assembled";
  if (status === "failed" || (!status && error)) return "failed";
  if (status === "configuring") return "configuring";
  if (hasBody) return "reviewing";
  return status ? "outline_ready" : "configuring";
}

export const draftWritingLabels: Record<DraftWritingStage | "resolved" | "cancelled" | "history", { label: string; hint: string; step: number }> = {
  configuring: { label: "正在整理大纲", hint: "先规划章节，确认方向后再生成正文。", step: 0 },
  outline_ready: { label: "大纲待确认", hint: "查看和调整章节后，再开始生成正文。", step: 0 },
  reviewing: { label: "正文待完善", hint: "逐章检查和补全正文，完成草稿后再保存为笔记。", step: 1 },
  generating: { label: "正在生成正文", hint: "收起工作台后，可以从聊天卡片继续查看。", step: 1 },
  assembling: { label: "正在整理全文", hint: "章节正在合并为可保存的草稿，尚未写入笔记库。", step: 1 },
  assembled: { label: "草稿待保存", hint: "检查正文后，确认标题和位置再保存为笔记。", step: 2 },
  saving: { label: "正在保存为笔记", hint: "保存成功后会打开新笔记。", step: 2 },
  failed: { label: "需要继续处理", hint: "内容尚未保存，请查看提示后重试。", step: -1 },
  resolved: { label: "已保存为笔记", hint: "草稿已保存到知识库。", step: 3 },
  cancelled: { label: "已放弃草稿", hint: "本次草稿已结束，没有保存为新笔记。", step: -1 },
  history: { label: "历史草稿", hint: "这是当时的草稿记录，不代表已经保存。", step: -1 },
};

// Bind only the latest unfinished card owned by this draft. Never recolor a
// previous same-topic task or a different checkpoint when a request completes.
export function draftConversationIndex(
  messages: ChatMessage[],
  owner: { checkpointId?: string | null; draftId?: string; seed: string },
): number {
  let index = -1;
  let bestRank = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const card = message.draftCard;
    if (!card || card.status === "resolved" || card.status === "cancelled") continue;
    const rank = card.checkpointId ? (card.checkpointId === owner.checkpointId ? 3 : 0)
      : card.draftId ? (card.draftId === owner.draftId ? 2 : 0) : card.seed === owner.seed ? 1 : 0;
    if (rank > bestRank) { index = i; bestRank = rank; }
  }
  return index;
}

export function updateDraftConversation(
  messages: ChatMessage[],
  owner: { checkpointId?: string | null; draftId?: string; seed: string },
  patch: Partial<NonNullable<ChatMessage["draftCard"]>>,
): ChatMessage[] {
  const index = draftConversationIndex(messages, owner);
  if (index < 0) return messages;
  if (Object.entries(patch).every(([key, value]) => messages[index].draftCard?.[key as keyof NonNullable<ChatMessage["draftCard"]>] === value)) return messages;
  return messages.map((message, i) => i === index ? { ...message, draftCard: { ...message.draftCard!, ...patch } } : message);
}
