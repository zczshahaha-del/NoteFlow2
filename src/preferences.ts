import type { AppView } from "./components/AppNav";

const APP_PREFERENCES_STORAGE_KEY = "noteflow-app-preferences";

export type DefaultView = Exclude<AppView, "settings">;

export interface AppPreferences {
  defaultView: DefaultView;
}

export const defaultViewOptions: Array<{ value: DefaultView; label: string }> = [
  { value: "knowledge", label: "知识库" },
];

export const defaultAppPreferences: AppPreferences = {
  defaultView: "knowledge",
};

function pickAllowed<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

export function normalizeAppPreferences(value: unknown): AppPreferences {
  const record =
    typeof value === "object" && value !== null
      ? (value as Partial<AppPreferences>)
      : {};

  return {
    defaultView: pickAllowed(
      record.defaultView,
      defaultViewOptions.map((option) => option.value),
      defaultAppPreferences.defaultView
    ),
  };
}

export function loadAppPreferences(): AppPreferences {
  try {
    const raw = localStorage.getItem(APP_PREFERENCES_STORAGE_KEY);
    return normalizeAppPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultAppPreferences;
  }
}

export function saveAppPreferences(preferences: AppPreferences) {
  try {
    localStorage.setItem(
      APP_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalizeAppPreferences(preferences))
    );
  } catch {}
}
