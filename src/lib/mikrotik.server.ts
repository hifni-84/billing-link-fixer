import type { Json, MtCreds, MtResult } from "./mikrotik-types";

const API_PORTS = new Set([8728, 8729]);

function looksLikeNoRest(res: MtResult) {
  if (res.status === 404 || res.status === 501 || res.status === 400) return true;
  if (res.status === 0) return true;
  return typeof res.data === "string" && res.data.toLowerCase().includes("<html");
}

export async function callRouterOs(
  creds: MtCreds,
  path: string,
  method: string,
  body?: unknown,
): Promise<MtResult> {
  // Port API biner → langsung pakai protokol API (RouterOS v6).
  if (creds.apiPort || (creds.port && API_PORTS.has(creds.port))) {
    const { callRouterOsApi } = await import("./routeros-api.server");
    return callRouterOsApi(
      { ...creds, apiPort: creds.apiPort ?? creds.port ?? 8728 },
      path,
      method,
      body,
    );
  }

  const rest = await callRouterOsRest(creds, path, method, body);
  if (rest.ok || !looksLikeNoRest(rest)) return rest;

  // REST tidak tersedia (umumnya RouterOS v6) → coba API biner 8728.
  const { callRouterOsApi } = await import("./routeros-api.server");
  const api = await callRouterOsApi({ ...creds, apiPort: 8728 }, path, method, body);
  return api.ok ? api : rest.status ? rest : api;
}

async function callRouterOsRest(
  creds: MtCreds,
  path: string,
  method: string,
  body?: unknown,
): Promise<MtResult> {
  const scheme = creds.useHttps ? "https" : "http";
  const port = creds.port ? `:${creds.port}` : "";
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${scheme}://${creds.host}${port}/rest${cleanPath}`;

  const auth = btoa(`${creds.username}:${creds.password}`);

  try {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetch(url, init);

    const text = await res.text();
    let parsed: Json = null;
    try {
      parsed = text ? (JSON.parse(text) as Json) : null;
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      const detail =
        parsed && typeof parsed === "object" && "detail" in (parsed as Record<string, unknown>)
          ? String((parsed as Record<string, Json>)["detail"])
          : typeof parsed === "string"
            ? parsed
            : res.statusText;
      return { ok: false, status: res.status, data: parsed, error: detail || "Permintaan gagal" };
    }

    return { ok: true, status: res.status, data: parsed };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Kesalahan tidak diketahui";
    return {
      ok: false,
      status: 0,
      data: null,
      error: `Tidak dapat menghubungi router (${message}). Pastikan service www (REST API) aktif dan router dapat diakses dari internet.`,
    };
  }
}
