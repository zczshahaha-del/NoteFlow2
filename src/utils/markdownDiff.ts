export type MarkdownDiffKind = "equal" | "add" | "remove";

export interface MarkdownDiffRow {
  kind: MarkdownDiffKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface MarkdownDiffResult {
  rows: MarkdownDiffRow[];
  added: number;
  removed: number;
  unchanged: number;
  simplified: boolean;
}

const MAX_LCS_CELLS = 500_000;

function linesOf(markdown: string): string[] {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  return normalized === "" ? [] : normalized.split("\n");
}

function appendRows(
  rows: MarkdownDiffRow[],
  kind: MarkdownDiffKind,
  lines: string[],
  oldStart: number,
  newStart: number
) {
  lines.forEach((line, index) => {
    rows.push({
      kind,
      text: line,
      oldLine: kind === "add" ? null : oldStart + index + 1,
      newLine: kind === "remove" ? null : newStart + index + 1,
    });
  });
}

function simplifiedDiff(oldLines: string[], newLines: string[]): MarkdownDiffResult {
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) prefix += 1;

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;

  const rows: MarkdownDiffRow[] = [];
  appendRows(rows, "equal", oldLines.slice(0, prefix), 0, 0);
  appendRows(
    rows,
    "remove",
    oldLines.slice(prefix, oldLines.length - suffix),
    prefix,
    prefix
  );
  appendRows(
    rows,
    "add",
    newLines.slice(prefix, newLines.length - suffix),
    prefix,
    prefix
  );
  appendRows(
    rows,
    "equal",
    oldLines.slice(oldLines.length - suffix),
    oldLines.length - suffix,
    newLines.length - suffix
  );
  return summarize(rows, true);
}

function summarize(rows: MarkdownDiffRow[], simplified: boolean): MarkdownDiffResult {
  return rows.reduce<MarkdownDiffResult>(
    (result, row) => {
      if (row.kind === "add") result.added += 1;
      else if (row.kind === "remove") result.removed += 1;
      else result.unchanged += 1;
      return result;
    },
    { rows, added: 0, removed: 0, unchanged: 0, simplified }
  );
}

export function diffMarkdownLines(oldMarkdown: string, newMarkdown: string): MarkdownDiffResult {
  const oldLines = linesOf(oldMarkdown);
  const newLines = linesOf(newMarkdown);
  const columns = newLines.length + 1;

  if ((oldLines.length + 1) * columns > MAX_LCS_CELLS) {
    return simplifiedDiff(oldLines, newLines);
  }

  const table = new Uint32Array((oldLines.length + 1) * columns);
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      const index = oldIndex * columns + newIndex;
      table[index] = oldLines[oldIndex] === newLines[newIndex]
        ? table[(oldIndex + 1) * columns + newIndex + 1] + 1
        : Math.max(table[(oldIndex + 1) * columns + newIndex], table[index + 1]);
    }
  }

  const rows: MarkdownDiffRow[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      rows.push({ kind: "equal", text: oldLines[oldIndex], oldLine: oldIndex + 1, newLine: newIndex + 1 });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < newLines.length &&
      (oldIndex >= oldLines.length ||
        table[oldIndex * columns + newIndex + 1] >= table[(oldIndex + 1) * columns + newIndex])
    ) {
      rows.push({ kind: "add", text: newLines[newIndex], oldLine: null, newLine: newIndex + 1 });
      newIndex += 1;
    } else {
      rows.push({ kind: "remove", text: oldLines[oldIndex], oldLine: oldIndex + 1, newLine: null });
      oldIndex += 1;
    }
  }

  return summarize(rows, false);
}
