/** Presentation only. Recognize an explicit leading cue, never classify prose
 * by keywords elsewhere or insert/remove an icon in the user's content. */
export function readingCalloutKind(text: string): "note" | "warning" | "success" | null {
  const start = text.trimStart();
  if (/^(?:⚠️?|❗|警告\s*[:：]|注意\s*[:：]|坑点\s*[:：])/.test(start)) return "warning";
  if (/^(?:✅|结论\s*[:：])/.test(start)) return "success";
  if (/^(?:💡|📌|📝|提示\s*[:：]|说明\s*[:：]|人话\s*[:：])/.test(start)) return "note";
  return null;
}
