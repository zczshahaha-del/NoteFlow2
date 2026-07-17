export const TIPTAP_AUTO_OPEN_MAX_CHARS = 40_000;

export interface EditorCompatibility {
  useModernEditor: boolean;
  reason: string | null;
}

export function evaluateEditorCompatibility(markdown: string): EditorCompatibility {
  if (/<details\b/i.test(markdown)) {
    return {
      useModernEditor: false,
      reason: "这篇课程包含可折叠资料，已使用完整阅读模式。",
    };
  }
  if (markdown.length > TIPTAP_AUTO_OPEN_MAX_CHARS) {
    return {
      useModernEditor: false,
      reason: `这篇长文超过 ${TIPTAP_AUTO_OPEN_MAX_CHARS.toLocaleString()} 字符，已自动使用兼容编辑模式。`,
    };
  }
  return { useModernEditor: true, reason: null };
}
