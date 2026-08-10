/** Pemeriksaan status koneksi tiap NAS: RADIUS (radacct) dan REST API router. */
import { callRouterOs } from "./mikrotik.server";
import { listNas, query } from "./radius.server";
import type { MtCreds } from "./mikrotik-types";

export type NasStatus = {
  nasname: string;
  /** ada trafik RADIUS dari NAS ini dalam 15 menit terakhir */
  radius: boolean;
  radiusLast: string | null;
  radiusSessions: number;
  /** jumlah request RADIUS yang dilaporkan router (via /radius monitor) */
  radiusRequests: number;
  radiusAccepts: number;
  radiusRejects: number;
  radiusTimeouts: number;
  /** router mempunyai entri RADIUS aktif untuk hotspot/PPP */
  radiusConfigured: boolean;
  /** REST API router bisa dihubungi dengan kredensial panel */
  api: boolean;
  apiError: string | null;
  identity: string | null;
};

export type NasCredEntry = Partial<MtCreds> & { host?: string };

export async function nasStatuses(
  creds?: Partial<MtCreds>,
  routers?: NasCredEntry[],
): Promise<NasStatus[]> {
  const nas = await listNas();

  let rows: { nasipaddress: string; sesi: number; terakhir: string | null }[] = [];
  try {
    rows = await query<{ nasipaddress: string; sesi: number; terakhir: string | null }>(
      `SELECT nasipaddress,
              SUM(acctstoptime IS NULL) AS sesi,
              DATE_FORMAT(MAX(COALESCE(acctupdatetime, acctstarttime)), '%Y-%m-%dT%H:%i:%sZ') AS terakhir
         FROM radacct
        WHERE COALESCE(acctupdatetime, acctstarttime) > (UTC_TIMESTAMP() - INTERVAL 7 DAY)
        GROUP BY nasipaddress`,
    );
  } catch {
    rows = [];
  }

  const byIp = new Map(rows.map((r) => [String(r.nasipaddress).trim().toLowerCase(), r]));

  // Statistik autentikasi per NAS (radpostauth) sebagai bukti tambahan bahwa
  // NAS ini benar-benar bertukar paket dengan server — dipakai agar beberapa
  // NAS sekaligus bisa terdeteksi aktif, bukan hanya yang punya sesi accounting.
  let auth: { nasipaddress: string; terakhir: string | null }[] = [];
  try {
    auth = await query<{ nasipaddress: string; terakhir: string | null }>(
      `SELECT COALESCE(nasipaddress,'') AS nasipaddress,
              DATE_FORMAT(MAX(authdate), '%Y-%m-%dT%H:%i:%sZ') AS terakhir
         FROM radpostauth
        WHERE authdate > (UTC_TIMESTAMP() - INTERVAL 7 DAY)
        GROUP BY nasipaddress`,
    );
  } catch {
    auth = [];
  }
  const authByIp = new Map(auth.map((a) => [String(a.nasipaddress).trim().toLowerCase(), a]));

  return Promise.all(
    nas.map(async (n) => {
      const key = n.nasname.trim().toLowerCase();
      const r = byIp.get(key);
      const a = authByIp.get(key);
      const times = [r?.terakhir ?? null, a?.terakhir ?? null].filter(Boolean) as string[];
      const last = times.length
        ? times.reduce((x, y) => (new Date(x) > new Date(y) ? x : y))
        : null;
      const fresh = last ? Date.now() - new Date(last).getTime() < 15 * 60 * 1000 : false;

      let api = false;
      let apiError: string | null = null;
      let identity: string | null = null;
      let mon = { requests: 0, accepts: 0, rejects: 0, timeouts: 0 };
      let radiusConfigured = false;

      // Kredensial khusus per NAS (router ke-2 dan seterusnya), jatuh ke kredensial aktif.
      const perHost = (routers ?? []).find(
        (r) => (r.host ?? "").trim().toLowerCase() === n.nasname.trim().toLowerCase(),
      );
      const c: Partial<MtCreds> = perHost ?? creds ?? {};

      if (c.username) {
        const res = await callRouterOs(
          {
            host: n.nasname,
            username: c.username ?? "admin",
            password: c.password ?? "",
            ...(c.port !== undefined ? { port: c.port } : {}),
            ...(c.useHttps !== undefined ? { useHttps: c.useHttps } : {}),
            ...(c.apiPort ? { apiPort: c.apiPort } : {}),
          },
          "/system/identity",
          "GET",
        );
        api = res.ok;
        if (res.ok && res.data && typeof res.data === "object" && !Array.isArray(res.data)) {
          const name = (res.data as Record<string, unknown>)["name"];
          identity = typeof name === "string" ? name : null;
        }
        if (!res.ok) apiError = res.error ?? "gagal";

        // Router yang bisa dihubungi: tanya langsung statistik RADIUS-nya.
        if (res.ok) {
          const rcreds = {
            host: n.nasname,
            username: c.username ?? "admin",
            password: c.password ?? "",
            ...(c.port !== undefined ? { port: c.port } : {}),
            ...(c.useHttps !== undefined ? { useHttps: c.useHttps } : {}),
            ...(c.apiPort ? { apiPort: c.apiPort } : {}),
          };
          // Semua entri RADIUS di router dipantau, bukan hanya index 0 — router
          // v6 sering punya beberapa entri (hotspot, ppp, login).
          const list = await callRouterOs(rcreds, "/radius", "GET").catch(() => ({
            ok: false as const,
            data: null,
          }));
          const entries = (
            list.ok && Array.isArray(list.data) ? (list.data as Record<string, unknown>[]) : []
          ).filter((e) => !!e);
          // RouterOS v6 tidak selalu mengembalikan counter dari /radius/monitor.
          // Entri RADIUS aktif tetap menjadi bukti konfigurasi siap ketika API
          // router dapat dijangkau melalui tunnel SSTP/L2TP/WireGuard.
          radiusConfigured = entries.some((e) => {
            // API RouterOS v6 bisa tidak mengirim properti service pada hasil
            // /radius/print. Selama entri tidak disabled, konfigurasi tersebut
            // valid; service sudah ditentukan saat entri dibuat di MikroTik.
            const disabled = String(e["disabled"] ?? "false").trim().toLowerCase();
            return disabled !== "true" && disabled !== "yes";
          });
          const ids = entries
            .map((e) => String(e[".id"] ?? ""))
            .filter(Boolean);
          const targets = ids.length ? ids : ["0"];

          for (const numbers of targets) {
            const stat = await callRouterOs(rcreds, "/radius/monitor", "POST", {
              numbers,
              once: "yes",
            }).catch(() => ({ ok: false as const, data: null, error: "gagal" }));
            const raw = stat.ok
              ? ((Array.isArray(stat.data) ? stat.data[0] : stat.data) as Record<
                  string,
                  unknown
                > | null)
              : null;
            if (!raw) continue;
            const num = (k: string) => Number(raw[k] ?? 0) || 0;
            mon = {
              requests: mon.requests + num("requests"),
              accepts: mon.accepts + num("accepts"),
              rejects: mon.rejects + num("rejects"),
              timeouts: mon.timeouts + num("timeouts"),
            };
          }
        }
      } else {
        apiError = "Kredensial router belum diisi di Pengaturan";
      }

      return {
        nasname: n.nasname,
        // Terhubung bila ada accounting terbaru/sesi aktif, ATAU router memang
        // berhasil bertukar paket dengan server (accepts / request tanpa timeout).
        radius:
          fresh ||
          Number(r?.sesi ?? 0) > 0 ||
          mon.accepts > 0 ||
          (mon.requests > 0 && mon.requests > mon.timeouts) ||
          (api && radiusConfigured),
        radiusLast: last,
        radiusSessions: Number(r?.sesi ?? 0),
        radiusRequests: mon.requests,
        radiusAccepts: mon.accepts,
        radiusRejects: mon.rejects,
        radiusTimeouts: mon.timeouts,
        radiusConfigured,
        api,
        apiError,
        identity,
      };
    }),
  );
}
