interface TextNodeLike {
  isText: boolean;
  text?: string | null;
}

interface DocumentLike {
  descendants: (callback: (node: TextNodeLike, position: number) => void) => void;
}

/**
 * Find a normalized text range in a ProseMirror document.
 *
 * ProseMirror positions and JavaScript string offsets both use UTF-16 code units.
 * Iterating by code unit is intentional: using Array.from would count emoji as one
 * item while ProseMirror counts the same emoji as two positions.
 */
export function findTiptapTextRange(
  document: DocumentLike,
  targetText: string
): { from: number; to: number } | null {
  const target = targetText.replace(/\s+/g, " ").trim();
  if (!target) return null;

  let searchable = "";
  const positions: number[] = [];
  let previousTextEnd: number | null = null;

  document.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    if (
      previousTextEnd !== null &&
      position > previousTextEnd &&
      searchable &&
      !searchable.endsWith(" ")
    ) {
      searchable += " ";
      positions.push(position);
    }
    for (let index = 0; index < node.text.length; index += 1) {
      const codeUnit = node.text[index];
      if (/\s/.test(codeUnit)) {
        if (!searchable || searchable.endsWith(" ")) continue;
        searchable += " ";
      } else {
        searchable += codeUnit;
      }
      positions.push(position + index);
    }
    previousTextEnd = position + node.text.length;
  });

  const matchIndex = searchable.indexOf(target);
  if (matchIndex < 0) return null;
  const start = positions[matchIndex];
  const end = positions[matchIndex + target.length - 1];
  if (start === undefined || end === undefined) return null;
  return { from: start, to: end + 1 };
}
