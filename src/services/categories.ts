import { apiFetch, readApiError, readApiJson } from "./api";

export interface NoteCategoryRecord {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
}

export interface CategoryPayload {
  id?: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
}

export async function listCategories(): Promise<NoteCategoryRecord[]> {
  const response = await apiFetch("/api/categories");
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ categories: NoteCategoryRecord[] }>(response);
  return data.categories;
}

export async function createCategory(
  payload: CategoryPayload
): Promise<NoteCategoryRecord> {
  const response = await apiFetch("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ category: NoteCategoryRecord }>(response);
  return data.category;
}

export async function updateCategory(
  categoryId: string,
  payload: CategoryPayload
): Promise<NoteCategoryRecord> {
  const response = await apiFetch(`/api/categories/${encodeURIComponent(categoryId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await readApiJson<{ category: NoteCategoryRecord }>(response);
  return data.category;
}

export async function deleteCategory(categoryId: string) {
  const response = await apiFetch(`/api/categories/${encodeURIComponent(categoryId)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readApiError(response));
}
