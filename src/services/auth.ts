import {
  apiFetch,
  clearLegacyToken,
  publicApiFetch,
  readApiError,
  readApiJson,
  rememberLegacyTokenForMigration,
} from "./api";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthSession {
  user: AuthUser;
  sessionExpiresAt?: string;
}

export interface UserSessionRecord {
  id: string;
  current: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

interface AuthPayload {
  email: string;
  password: string;
  displayName?: string;
}

interface CachedAuthSession {
  session: AuthSession;
  expiresAt: number;
}

const CACHED_AUTH_SESSION_KEY = "noteflow:cached-auth-session";
const DEFAULT_OFFLINE_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheAuthSession(session: AuthSession): void {
  if (typeof localStorage === "undefined") return;
  const parsedExpiry = session.sessionExpiresAt ? Date.parse(session.sessionExpiresAt) : Number.NaN;
  const expiresAt = Number.isFinite(parsedExpiry)
    ? parsedExpiry
    : Date.now() + DEFAULT_OFFLINE_SESSION_TTL_MS;
  try {
    localStorage.setItem(CACHED_AUTH_SESSION_KEY, JSON.stringify({ session, expiresAt }));
  } catch {}
}

function loadCachedAuthSession(): AuthSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHED_AUTH_SESSION_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedAuthSession;
    if (!cached?.session?.user?.id || !Number.isFinite(cached.expiresAt) || cached.expiresAt <= Date.now()) {
      localStorage.removeItem(CACHED_AUTH_SESSION_KEY);
      return null;
    }
    return cached.session;
  } catch {
    return null;
  }
}

function clearCachedAuthSession(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(CACHED_AUTH_SESSION_KEY);
  } catch {}
}

async function submitAuth(path: string, payload: AuthPayload): Promise<AuthSession> {
  // A deliberate sign-in/register must always win over a token left by the old
  // frontend. Abort any migration before the new cookie is issued; otherwise a
  // late legacy response can overwrite the freshly authenticated account.
  clearLegacyToken();
  const response = await publicApiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const session = await readApiJson<AuthSession & { token?: string }>(response);
  if (session.token) rememberLegacyTokenForMigration(session.token);
  cacheAuthSession(session);
  return session;
}

export function login(payload: AuthPayload): Promise<AuthSession> {
  return submitAuth("/api/auth/login", payload);
}

export function register(payload: AuthPayload): Promise<AuthSession> {
  return submitAuth("/api/auth/register", payload);
}

export async function loadCurrentSession(): Promise<AuthSession | null> {
  try {
    const response = await apiFetch("/api/auth/me");
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) clearCachedAuthSession();
      return null;
    }
    const data = await readApiJson<{ user: AuthUser }>(response);
    const session = { user: data.user };
    cacheAuthSession(session);
    return session;
  } catch (error) {
    const cachedSession = loadCachedAuthSession();
    if (cachedSession) return cachedSession;
    throw error;
  }
}

export async function logout(): Promise<void> {
  clearLegacyToken();
  clearCachedAuthSession();
  await publicApiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
}

export async function listUserSessions(): Promise<UserSessionRecord[]> {
  const response = await apiFetch("/api/auth/sessions");
  if (!response.ok) throw new Error(await readApiError(response));
  return readApiJson<UserSessionRecord[]>(response);
}

export async function revokeUserSession(sessionId: string): Promise<boolean> {
  const response = await apiFetch(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const result = await readApiJson<{ currentSessionRevoked: boolean }>(response);
  return result.currentSessionRevoked;
}

export async function requestPasswordReset(email: string): Promise<{
  message: string;
  developmentToken?: string;
}> {
  const response = await publicApiFetch("/api/auth/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return readApiJson<{ message: string; developmentToken?: string }>(response);
}

export async function confirmPasswordReset(
  email: string,
  token: string,
  newPassword: string
): Promise<string> {
  const response = await publicApiFetch("/api/auth/password-reset/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, token, newPassword }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const result = await readApiJson<{ message: string }>(response);
  return result.message;
}
