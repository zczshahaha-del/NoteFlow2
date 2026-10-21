import type { FileNode } from "../types";

interface ZipEntry {
  path: string;
  content: string;
}

const encoder = new TextEncoder();

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function concatChunks(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function makeHeader(length: number, fill: (view: DataView) => void): Uint8Array {
  const header = new Uint8Array(length);
  fill(new DataView(header.buffer));
  return header;
}

function safeSegment(value: string): string {
  const cleaned = value
    .replace(/\.md$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "未命名";
}

function uniquePath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const dotIndex = path.lastIndexOf(".");
  const base = dotIndex > 0 ? path.slice(0, dotIndex) : path;
  const extension = dotIndex > 0 ? path.slice(dotIndex) : "";
  let index = 2;
  let next = `${base} (${index})${extension}`;

  while (usedPaths.has(next)) {
    index += 1;
    next = `${base} (${index})${extension}`;
  }

  usedPaths.add(next);
  return next;
}

function collectEntries(
  nodes: FileNode[],
  fileContents: Record<string, string>,
  parentPath: string,
  usedPaths: Set<string>
): ZipEntry[] {
  return nodes.flatMap((node) => {
    if (node.type === "folder") {
      const folderPath = parentPath
        ? `${parentPath}/${safeSegment(node.name)}`
        : safeSegment(node.name);
      return collectEntries(node.children ?? [], fileContents, folderPath, usedPaths);
    }

    const fileName = `${safeSegment(node.name)}.md`;
    const path = uniquePath(parentPath ? `${parentPath}/${fileName}` : fileName, usedPaths);
    return [
      {
        path,
        content: fileContents[node.id] ?? node.content ?? "",
      },
    ];
  });
}

export function countKnowledgeFiles(nodes: FileNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.type === "file") return total + 1;
    return total + countKnowledgeFiles(node.children ?? []);
  }, 0);
}

export function createKnowledgeZipBlob(
  treeData: FileNode[],
  fileContents: Record<string, string>
): Blob {
  const entries = collectEntries(treeData, fileContents, "", new Set());
  const files = entries.length
    ? entries
    : [{ path: "README.md", content: "# NoteFlow\n\n当前知识库没有笔记文件。\n" }];

  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  const { dosDate, dosTime } = dosDateTime();
  let offset = 0;

  files.forEach((entry) => {
    const nameBytes = encoder.encode(entry.path);
    const contentBytes = encoder.encode(entry.content);
    const checksum = crc32(contentBytes);
    const localOffset = offset;

    const localHeader = makeHeader(30, (view) => {
      writeUint32(view, 0, 0x04034b50);
      writeUint16(view, 4, 20);
      writeUint16(view, 6, 0x0800);
      writeUint16(view, 8, 0);
      writeUint16(view, 10, dosTime);
      writeUint16(view, 12, dosDate);
      writeUint32(view, 14, checksum);
      writeUint32(view, 18, contentBytes.length);
      writeUint32(view, 22, contentBytes.length);
      writeUint16(view, 26, nameBytes.length);
      writeUint16(view, 28, 0);
    });

    chunks.push(localHeader, nameBytes, contentBytes);
    offset += localHeader.length + nameBytes.length + contentBytes.length;

    const centralHeader = makeHeader(46, (view) => {
      writeUint32(view, 0, 0x02014b50);
      writeUint16(view, 4, 20);
      writeUint16(view, 6, 20);
      writeUint16(view, 8, 0x0800);
      writeUint16(view, 10, 0);
      writeUint16(view, 12, dosTime);
      writeUint16(view, 14, dosDate);
      writeUint32(view, 16, checksum);
      writeUint32(view, 20, contentBytes.length);
      writeUint32(view, 24, contentBytes.length);
      writeUint16(view, 28, nameBytes.length);
      writeUint16(view, 30, 0);
      writeUint16(view, 32, 0);
      writeUint16(view, 34, 0);
      writeUint16(view, 36, 0);
      writeUint32(view, 38, 0);
      writeUint32(view, 42, localOffset);
    });

    centralDirectory.push(centralHeader, nameBytes);
  });

  const centralOffset = offset;
  const centralBytes = concatChunks(centralDirectory);
  chunks.push(centralBytes);
  offset += centralBytes.length;

  const endHeader = makeHeader(22, (view) => {
    writeUint32(view, 0, 0x06054b50);
    writeUint16(view, 4, 0);
    writeUint16(view, 6, 0);
    writeUint16(view, 8, files.length);
    writeUint16(view, 10, files.length);
    writeUint32(view, 12, centralBytes.length);
    writeUint32(view, 16, centralOffset);
    writeUint16(view, 20, 0);
  });
  chunks.push(endHeader);

  return new Blob([concatChunks(chunks).buffer], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function makeKnowledgeBackupName(prefix = "noteflow-knowledge-base"): string {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${prefix}-${yyyy}${mm}${dd}-${hh}${mi}.zip`;
}

export function createKnowledgeJsonBlob(
  treeData: FileNode[],
  fileContents: Record<string, string>
): Blob {
  return new Blob([
    JSON.stringify({
      format: "noteflow-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      treeData,
      fileContents,
    }, null, 2),
  ], { type: "application/json;charset=utf-8" });
}

export function makeKnowledgeJsonName(): string {
  return makeKnowledgeBackupName().replace(/\.zip$/i, ".json");
}
