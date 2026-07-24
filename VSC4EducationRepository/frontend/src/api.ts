const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000/api";

type PaginatedResponse<T> = {
  next?: string | null;
  results: T[];
};

function apiUrl(pathOrUrl: string) {
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function getListJson<T>(path: string): Promise<T[]> {
  const firstPage = await getJson<T[] | PaginatedResponse<T>>(path);
  if (Array.isArray(firstPage)) {
    return firstPage;
  }
  if (!Array.isArray(firstPage.results)) {
    throw new Error("La API no devolvio una lista valida.");
  }

  const items = [...firstPage.results];
  let next = firstPage.next;
  while (next) {
    const page = await getJson<PaginatedResponse<T>>(next);
    items.push(...page.results);
    next = page.next;
  }
  return items;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export function repositoryBaseUrl(): string {
  return API_BASE.replace(/\/api\/?$/i, "").replace(/\/+$/, "");
}

export async function uploadZip<T>(path: string, file: File, extra: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append("zip", file);
  Object.entries(extra).forEach(([key, value]) => {
    if (value) {
      form.append(key, value);
    }
  });
  const response = await fetch(apiUrl(path), {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}
