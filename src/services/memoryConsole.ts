import { apiFetch, readApiError, readApiJson } from './api';

export async function memoryConsole<T = any>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await apiFetch('/api/memory-console' + path, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return readApiJson<T>(response);
}
