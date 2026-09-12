export function currentOrgId() {
  return localStorage.getItem("dialix.org") ?? "";
}

export function setCurrentOrgId(id: string) {
  localStorage.setItem("dialix.org", id);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const org = currentOrgId();
  if (org) headers.set("x-organization-id", org);
  const res = await fetch(path, { ...init, credentials: "include", headers });
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 401) {
    window.dispatchEvent(new Event("dialix:unauthorized"));
    throw new ApiError("You are not signed in or your session expired. Sign in again.", 401);
  }
  if (!res.ok) {
    const data = contentType.includes("json")
      ? ((await res.json()) as { error?: string; message?: string; details?: unknown })
      : { error: await res.text() };
    throw new ApiError(data.error || data.message || `Request failed (${res.status}) for ${path}`, res.status, data.details);
  }
  if (contentType.includes("text/csv") || contentType.includes("octet-stream") || contentType.includes("text/plain")) {
    return (await res.blob()) as T;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}. Try a smaller audio file.`));
    reader.readAsDataURL(file);
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
