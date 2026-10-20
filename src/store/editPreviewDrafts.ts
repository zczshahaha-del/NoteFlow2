import type { NoteEditPreviewRecord } from "../services/edits";

export interface EditPreviewDraft {
  content: string;
  savedContent: string;
  expectedUpdatedAt: string | null;
  status: "unsaved" | "saving" | "saved" | "error";
  error: string;
  saveUncertain: boolean;
  /** A new draft after account hydration must not consume an older request. */
  generation: number;
}

/** A clean cached draft must not mask a newer server preview when reopened. */
export function currentEditPreviewDraft(preview: NoteEditPreviewRecord | null, draft: EditPreviewDraft | undefined): EditPreviewDraft | undefined {
  if (!preview || !draft) return undefined;
  return draft.status === "saved" && !draft.saveUncertain && draft.content === draft.savedContent
    && (preview.newContent !== draft.savedContent || preview.updatedAt !== draft.expectedUpdatedAt) ? undefined : draft;
}

interface DraftSaverOptions {
  read: (id: string) => EditPreviewDraft | undefined;
  update: (id: string, generation: number, patch: Partial<EditPreviewDraft>, preview?: NoteEditPreviewRecord) => void;
  save: (id: string, content: string, expectedUpdatedAt: string) => Promise<NoteEditPreviewRecord>;
}

/** Saves one preview at a time, and drains edits made while its request is pending. */
export function createEditPreviewDraftSaver(options: DraftSaverOptions) {
  const jobs = new Map<string, { generation: number; promise: Promise<void> }>();
  const flush = (id: string): Promise<void> => {
    const initial = options.read(id);
    if (!initial) return Promise.resolve();
    const pending = jobs.get(id);
    if (pending?.generation === initial.generation) return pending.promise;

    const job = { generation: initial.generation, promise: Promise.resolve() };
    // Schedule the loop after registering its promise, including synchronous adapters.
    job.promise = Promise.resolve().then(async () => {
      while (true) {
        const draft = options.read(id);
        if (!draft || draft.generation !== job.generation) return;
        if (draft.content === draft.savedContent && !draft.saveUncertain) {
          options.update(id, job.generation, { status: "saved", error: "" });
          return;
        }
        options.update(id, job.generation, { status: "saving", error: "" });
        try {
          if (!draft.expectedUpdatedAt) throw new Error("当前预览缺少版本信息，手动稿已保留，请重新打开预览后重试。");
          const preview = await options.save(id, draft.content, draft.expectedUpdatedAt);
          const latest = options.read(id);
          if (!latest || latest.generation !== job.generation) return;
          options.update(id, job.generation, {
            savedContent: preview.newContent,
            expectedUpdatedAt: preview.updatedAt,
            status: latest.content === preview.newContent ? "saved" : "unsaved",
            error: "",
            saveUncertain: false,
          }, preview);
        } catch (error) {
          const latest = options.read(id);
          if (!latest || latest.generation !== job.generation) return;
          options.update(id, job.generation, {
            status: "error",
            saveUncertain: true,
            error: error instanceof Error ? error.message : "手动修改保存失败，稿件已保留。",
          });
          throw error;
        }
      }
    }).finally(() => { if (jobs.get(id) === job) jobs.delete(id); });
    jobs.set(id, job);
    return job.promise;
  };
  return { flush };
}
