export interface DraftBrief {
  title: string;
  requirements: string;
  rawRequest: string;
}

// The original request remains provenance; the editable fields are authoritative
// for this generation, including an explicitly cleared requirements field.
export function buildDraftGenerationRequest(brief: DraftBrief): string {
  return [
    `原始请求（仅供来源核对，与当前要求冲突时以当前要求为准）：\n${brief.rawRequest.trim()}`,
    `当前生成标题：${brief.title.trim()}`,
    `当前生成要求：${brief.requirements.trim() || "未另行指定。不沿用已被清空或替换的旧要求。"}`,
    "按当前标题和要求确定文档用途与组织方式，不统一套用技术教程；不要擅自补造用户未指定的年级、课时等条件。",
  ].join("\n\n");
}

export function sameDraftBrief(a: DraftBrief, b?: DraftBrief | null): boolean {
  return Boolean(b && a.title.trim() === b.title.trim() && a.requirements.trim() === b.requirements.trim());
}
