const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, "") ?? "";
const LEGACY_TOKEN_KEY = "noteflow-auth-token";

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

let refreshRequest: Promise<boolean> | null = null;
let legacyMigrationRequest: Promise<string | null> | null = null;
let legacyMigrationAbortController: AbortController | null = null;

function legacyToken(): string | null {
  try {
    return localStorage.getItem(LEGACY_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function rememberLegacyTokenForMigration(token: string): void {
  try {
    localStorage.setItem(LEGACY_TOKEN_KEY, token);
    legacyMigrationRequest = null;
  } catch {}
}

export function clearLegacyToken(): void {
  legacyMigrationAbortController?.abort();
  legacyMigrationAbortController = null;
  legacyMigrationRequest = null;
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {}
}

async function migrateLegacyToken(): Promise<string | null> {
  const token = legacyToken();
  if (!token) return null;
  if (!legacyMigrationRequest) {
    const controller = new AbortController();
    legacyMigrationAbortController = controller;
    legacyMigrationRequest = fetch(apiUrl("/api/auth/migrate-legacy-token"), {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (response.ok) {
          clearLegacyToken();
          return null;
        }
        return token;
      })
      .catch(() => (legacyToken() ? token : null))
      .finally(() => {
        if (legacyMigrationAbortController === controller) {
          legacyMigrationAbortController = null;
        }
        legacyMigrationRequest = null;
      });
  }
  return legacyMigrationRequest;
}

async function refreshSession(): Promise<boolean> {
  if (!refreshRequest) {
    refreshRequest = fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
      credentials: "include",
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshRequest = null;
      });
  }
  return refreshRequest;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const transitionalToken = await migrateLegacyToken();
  const request = () => {
    const headers = new Headers(init.headers);
    if (transitionalToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${transitionalToken}`);
    }
    return fetch(apiUrl(path), { ...init, credentials: "include", headers });
  };
  const response = await request();
  if (response.status !== 401 || path.includes("/api/auth/refresh")) return response;
  return (await refreshSession()) ? request() : response;
}

export async function publicApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), { ...init, credentials: "include" });
}

export async function readApiError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText || "请求失败";

  try {
    const data = JSON.parse(text) as {
      detail?: unknown;
      error?: string | { code?: string; message?: string };
      code?: string;
    };
    if (typeof data.detail === "string" && data.detail.trim()) return data.detail.trim();
    if (Array.isArray(data.detail) && data.detail.length > 0) return "请求参数有误，请检查后再试。";
    if (typeof data.error === "object" && data.error?.message) return data.error.message;
    if (typeof data.error === "string" && data.error) return data.error;
    return response.statusText || "请求失败";
  } catch {
    const isHtml = text.trimStart().startsWith("<!doctype") || text.trimStart().startsWith("<html");
    if (isHtml) {
      return "API 返回了前端 HTML 页面，说明 /api 没有正确转发到后端。请检查 Nginx /api 反向代理或 VITE_API_BASE_URL。";
    }
    return text.trim() || response.statusText || "请求失败";
  }
}

export async function readApiJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (!contentType.includes("application/json")) {
    const isHtml = text.trimStart().startsWith("<!doctype") || text.trimStart().startsWith("<html");
    throw new Error(
      isHtml
        ? "API 返回了前端 HTML 页面，说明 /api 没有正确转发到后端。请检查 Nginx /api 反向代理或 VITE_API_BASE_URL。"
        : "API 没有返回 JSON，请检查后端接口。"
    );
  }

  return JSON.parse(text) as T;
}
