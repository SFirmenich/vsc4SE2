const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000/api";

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function uploadZip<T>(path: string, file: File, extra: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append("zip", file);
  Object.entries(extra).forEach(([key, value]) => {
    if (value) {
      form.append(key, value);
    }
  });
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}
