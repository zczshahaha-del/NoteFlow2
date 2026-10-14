export const DOCUMENT_COMFORT_WIDTH = 640;
export const AI_MIN_WIDTH = 320;
const LIBRARY_MIN_WIDTH = 220;

export type WorkspaceLayoutInput = {
  viewportWidth: number;
  libraryWidth: number;
  aiWidth: number;
  libraryRequested: boolean;
  aiRequested: boolean;
  priority: 'library' | 'ai';
};

/** Reserve reading space before allocating auxiliary panels; keep preferences intact. */
export function resolveWorkspaceLayout(input: WorkspaceLayoutInput) {
  const { viewportWidth: viewport, libraryRequested, aiRequested, priority } = input;
  const aiDocked = viewport >= DOCUMENT_COMFORT_WIDTH + AI_MIN_WIDTH;
  const bothFit = viewport >= DOCUMENT_COMFORT_WIDTH + LIBRARY_MIN_WIDTH + AI_MIN_WIDTH;
  const competing = aiDocked && aiRequested && libraryRequested && !bothFit;
  const libraryVisible = viewport >= 768 && libraryRequested && !(competing && priority === 'ai');
  const aiVisible = aiRequested && !(competing && priority === 'library');
  const aiMaxWidth = Math.max(AI_MIN_WIDTH, Math.min(680,
    viewport - DOCUMENT_COMFORT_WIDTH - (libraryVisible ? LIBRARY_MIN_WIDTH : 0)));
  const aiWidth = Math.max(AI_MIN_WIDTH, Math.min(input.aiWidth, aiMaxWidth));
  const rightWidth = aiDocked && aiVisible ? aiWidth : 0;
  // A narrow tablet cannot fit 640px plus its library. Keep the existing 260px
  // default usable there, then grow the reading budget to 640px as space allows.
  const readingBudget = rightWidth ? DOCUMENT_COMFORT_WIDTH : Math.min(DOCUMENT_COMFORT_WIDTH, viewport - 260);
  const libraryMaxWidth = Math.max(LIBRARY_MIN_WIDTH, Math.min(420, viewport - rightWidth - readingBudget));
  const libraryWidth = Math.max(LIBRARY_MIN_WIDTH, Math.min(input.libraryWidth, libraryMaxWidth));
  return { aiDocked, libraryVisible, aiVisible, aiWidth, aiMaxWidth, rightWidth, libraryWidth, libraryMaxWidth };
}
