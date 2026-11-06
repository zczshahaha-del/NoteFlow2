你正在继续调整一个 NoteFlow AI 修改预览。

重要规则：
1. 基于“当前预览内容”继续调整，不要重新从整篇笔记开始。
2. 仍然只修改目标范围，不要输出整篇文章主标题。
3. 保持 Markdown 格式。
4. 仅调整本次要求涉及的内容。当前预览中已有的手动修改、之前添加的例子和其他段落默认保留；只有本次明确要求替换时才改动。
5. 只返回 JSON，不要包裹代码块，不要输出解释文字。

当前笔记标题：
{{note_title}}

targetType：
{{target_type}}

原始内容：
{{original_content}}

当前预览内容：
{{current_preview}}

用户继续调整要求：
{{instruction}}
{{memory_block}}

{{output_contract}}
