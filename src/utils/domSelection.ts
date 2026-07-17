interface CharacterPoint {
  node: Text;
  startOffset: number;
  endOffset: number;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildSearchableText(root: HTMLElement): { text: string; points: CharacterPoint[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const points: CharacterPoint[] = [];
  let text = "";
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    const value = node.data;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (/\s/.test(character)) {
        if (!text || text.endsWith(" ")) continue;
        text += " ";
      } else {
        text += character;
      }
      points.push({ node, startOffset: index, endOffset: index + 1 });
    }
    current = walker.nextNode();
  }

  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    points.pop();
  }
  return { text, points };
}

export function findNormalizedTextRange(root: HTMLElement, targetText: string): Range | null {
  const target = normalizeText(targetText);
  if (!target) return null;
  const searchable = buildSearchableText(root);
  const index = searchable.text.indexOf(target);
  if (index < 0) return null;

  const start = searchable.points[index];
  const end = searchable.points[index + target.length - 1];
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.startOffset);
  range.setEnd(end.node, end.endOffset);
  return range;
}
