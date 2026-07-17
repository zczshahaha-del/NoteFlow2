import type { FileNode } from "../types";

export interface WikiLink {
  title: string;
  heading: string | null;
  label: string;
  raw: string;
}

export interface FlatNote {
  node: FileNode;
  path: string;
  title: string;
  content: string;
}

export function normalizeWikiTitle(value: string): string {
  return value.trim().replace(/\.md$/i, "").replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

export function extractWikiLinks(markdown: string): WikiLink[] {
  const searchable = markdown
    .replace(/(?:^|\n)(?:```|~~~)[\s\S]*?(?:\n(?:```|~~~)(?=\n|$)|$)/g, "\n")
    .replace(/`[^`\n]*`/g, "");
  const links: WikiLink[] = [];
  const pattern = /\[\[([^\[\]\n|#]+?)(?:#([^\[\]\n|]+?))?(?:\|([^\[\]\n]+?))?\]\]/g;
  for (const match of searchable.matchAll(pattern)) {
    const title = match[1].trim();
    if (!title) continue;
    const heading = match[2]?.trim() || null;
    const label = match[3]?.trim() || (heading ? `${title} › ${heading}` : title);
    links.push({ title, heading, label, raw: match[0] });
  }
  return links;
}

export function flattenWikiNotes(
  nodes: FileNode[],
  fileContents: Record<string, string>,
  parents: string[] = []
): FlatNote[] {
  return nodes.flatMap((node) => {
    if (node.type === "file") {
      return [{
        node,
        path: parents.join(" / ") || "知识库",
        title: node.name.replace(/\.md$/i, ""),
        content: fileContents[node.id] ?? node.content ?? "",
      }];
    }
    return flattenWikiNotes(node.children ?? [], fileContents, [...parents, node.name]);
  });
}

export function findWikiBacklinks(notes: FlatNote[], currentNoteId: string, currentTitle: string): FlatNote[] {
  const normalizedCurrentTitle = normalizeWikiTitle(currentTitle);
  return notes.filter((note) =>
    note.node.id !== currentNoteId &&
    extractWikiLinks(note.content).some((link) => normalizeWikiTitle(link.title) === normalizedCurrentTitle)
  );
}
