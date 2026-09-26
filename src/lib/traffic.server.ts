/**
 * Pembaca statistik trafik aplikasi dari ntopng (REST API v2).
 * Default: http://127.0.0.1:3005 dengan login admin/admin, bisa diubah
 * lewat env NTOPNG_URL / NTOPNG_USER / NTOPNG_PASS / NTOPNG_IFACE.
 */

import type {
  TrafficApp,
  TrafficAppKey,
  TrafficClient,
  TrafficSnapshot,
} from "./traffic-types";
import { TRAFFIC_APPS } from "./traffic-types";

type Row = Record<string, unknown>;

const cfg = () => ({
  url: (process.env["NTOPNG_URL"] || "http://127.0.0.1:3005").replace(/\/+$/, ""),
  user: process.env["NTOPNG_USER"] || "admin",
  pass: process.env["NTOPNG_PASS"] || "admin",
  iface: process.env["NTOPNG_IFACE"] || "",
});

async function ntop(path: string, params: Record<string, string | number> = {}) {
  const c = cfg();
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const auth = `Basic ${Buffer.from(`${c.user}:${c.pass}`).toString("base64")}`;
  const headers = { authorization: auth, "content-type": "application/json" };

  const tryFetch = async (init: RequestInit, withQs: boolean) => {
    const url = `${c.url}${path}${withQs && qs ? `?${qs}` : ""}`;
    const res = await fetch(url, { ...init, headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) throw new Error("LOGIN");
    if (res.status === 401 || res.status === 403) throw new Error("LOGIN");
    if (!res.ok) throw new Error(`ntopng ${res.status} ${path}`);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error("LOGIN");
    const json = JSON.parse(text) as Row;
    return json?.["rsp"] ?? json;
  };

  const loginMsg =
    "ntopng menolak login billing. Password admin ntopng sudah diganti — isi NTOPNG_USER dan NTOPNG_PASS di pengaturan server billing (lihat petunjuk).";
  try {
    return await tryFetch({ method: "GET" }, true);
  } catch (e) {
    try {
      return await tryFetch({ method: "POST", body: JSON.stringify(params) }, false);
    } catch (e2) {
      const m = (e2 as Error).message || (e as Error).message;
      throw new Error(m === "LOGIN" ? loginMsg : m);
    }
  }
}

const num = (r: Row, ...keys: string[]) => {
  for (const k of keys) {
    const v = k.split(".").reduce<unknown>((a, p) => (a as Row)?.[p], r);
    const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
};

const str = (r: Row, ...keys: string[]) => {
  for (const k of keys) {
    const v = k.split(".").reduce<unknown>((a, p) => (a as Row)?.[p], r);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
};

const isPrivate = (ip: string) =>
  /^10\./.test(ip) ||
  /^192\.168\./.test(ip) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

/** Pola pencocokan nama protokol L7 nDPI + nama domain (SNI) per aplikasi. */
const RULES: Record<TrafficAppKey, RegExp> = {
  youtube: /youtube|googlevideo|yt3\.ggpht|ytimg/i,
  tiktok: /tiktok|musical\.?ly|byte(dance|cdn)|ibyteimg|tiktokcdn/i,
  facebook: /facebook|fbcdn|messenger|\bfb\b/i,
  instagram: /instagram|cdninstagram/i,
  whatsapp: /whatsapp|wa\.me|whatsappnet/i,
  telegram: /telegram|tdesktop|\btg\b|\bt\.me\b|telesco\.pe|mtproto/i,
  game: /gaming|game|mobilelegends|moonton|garena|freefire|pubg|steam|riot|valorant|genshin|mihoyo|roblox|epicgames|battle\.?net|playstation|xbox|codm|efootball|supercell|clashofclans/i,
  meeting: /zoom|webex|gotomeeting|teams|skype|meet\.google|googlemeet|hangout|whereby|jitsi/i,
  browsing: /\b(http|https|tls|quic|ssl|web|google|bing|yahoo|wikipedia|shopee|tokopedia|lazada|blogspot|wordpress|news|detik|kompas|tribun|okezone|cloudflare|amazonaws|akamai|cdn)\b/i,
  other: /.^/,
};

/** Aplikasi utama (tanpa browsing/other) diperiksa lebih dulu. */
const PRIMARY = TRAFFIC_APPS.map((a) => a.key).filter(
  (k) => k !== "browsing" && k !== "other",
);

function classify(text: string): TrafficAppKey {
  for (const key of PRIMARY) {
    if (RULES[key].test(text)) return key;
  }
  if (RULES.browsing.test(text)) return "browsing";
  return "other";
}

async function pickIface() {
  const c = cfg();
  const list = (await ntop("/lua/rest/v2/get/ntopng/interfaces.lua")) as Row[] | Row;
  const rows = Array.isArray(list) ? list : Object.values(list ?? {});
  const norm = rows
    .map((r) => ({
      id: num(r as Row, "ifid", "id"),
      name: str(r as Row, "ifname", "name", "label"),
    }))
    .filter((r) => r.name);
  if (!norm.length) return { id: 0, name: c.iface || "iface" };
  if (c.iface) {
    const found = norm.find((r) => r.name === c.iface);
    if (found) return found;
  }
  const physical = norm.find((r) => /^(en|eth|wl|bond|br)/.test(r.name));
  return physical ?? norm[0]!;
}

async function activeFlows(ifid: number): Promise<Row[]> {
  const paths = [
    "/lua/rest/v2/get/flow/active.lua",
    "/lua/rest/v2/get/flows/active.lua",
  ];
  for (const p of paths) {
    try {
      const rsp = (await ntop(p, { ifid, currentPage: 1, perPage: 2000 })) as Row;
      const data = (rsp?.["data"] ?? rsp) as Row[] | Row;
      const rows = Array.isArray(data) ? data : Object.values(data ?? {});
      if (rows.length) return rows as Row[];
    } catch {
      /* coba endpoint berikutnya */
    }
  }
  return [];
}

async function sessionIpMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { listSessions } = await import("./radius.server");
    for (const s of await listSessions()) {
      if (s.framedipaddress) map.set(s.framedipaddress, s.username);
    }
  } catch {
    /* database billing tidak tersedia — tampilkan IP saja */
  }
  return map;
}

export async function trafficSnapshot(): Promise<TrafficSnapshot> {
  const c = cfg();
  const base: TrafficSnapshot = {
    ok: false,
    error: null,
    iface: null,
    url: c.url,
    totalBytes: 0,
    totalBps: 0,
    totalUsers: 0,
    apps: TRAFFIC_APPS.map((a) => ({
      ...a,
      bytes: 0,
      bps: 0,
      users: 0,
      flows: 0,
      clients: [],
    })),
    updatedAt: new Date().toISOString(),
  };

  let iface: { id: number; name: string };
  try {
    iface = await pickIface();
  } catch (e) {
    return { ...base, error: (e as Error).message || "Tidak bisa menghubungi ntopng" };
  }

  const flows = await activeFlows(iface.id);
  const users = await sessionIpMap();

  const buckets = new Map<TrafficAppKey, Map<string, TrafficClient>>();
  const agg = new Map<TrafficAppKey, { bytes: number; bps: number; flows: number }>();

  for (const f of flows) {
    const label = [
      str(f, "proto.l7", "l7_proto_name", "l7_proto", "protocol.l7", "application"),
      str(f, "proto.master_l7", "l7_master_proto_name"),
      str(f, "proto.app", "l7_app_proto_name", "l7proto"),
      str(f, "info", "server_name", "sni", "tls.server_name", "host_server_name"),
      str(f, "srv.name", "srv_ip.label", "server.name"),
    ]
      .filter(Boolean)
      .join(" ");

    const cli = str(f, "cli.ip", "cli_ip.ip", "client.ip", "cli_ip");
    const srv = str(f, "srv.ip", "srv_ip.ip", "server.ip", "srv_ip");
    const key: TrafficAppKey =
      isTelegramIp(srv) || isTelegramIp(cli) ? "telegram" : classify(label);
    const ip = isPrivate(cli) ? cli : isPrivate(srv) ? srv : cli || srv;
    if (!ip) continue;

    const bytes =
      num(f, "bytes", "total_bytes") ||
      num(f, "cli2srv_bytes") + num(f, "srv2cli_bytes");
    const bps =
      num(f, "throughput_bps", "throughput", "bps", "thpt.bps") ||
      num(f, "cli2srv_thpt") + num(f, "srv2cli_thpt");

    const a = agg.get(key) ?? { bytes: 0, bps: 0, flows: 0 };
    a.bytes += bytes;
    a.bps += bps;
    a.flows += 1;
    agg.set(key, a);

    const bucket = buckets.get(key) ?? new Map<string, TrafficClient>();
    const cur =
      bucket.get(ip) ?? { ip, username: users.get(ip) ?? null, bytes: 0, bps: 0, flows: 0 };
    cur.bytes += bytes;
    cur.bps += bps;
    cur.flows += 1;
    bucket.set(ip, cur);
    buckets.set(key, bucket);
  }

  const apps: TrafficApp[] = TRAFFIC_APPS.map(({ key, label }) => {
    const a = agg.get(key) ?? { bytes: 0, bps: 0, flows: 0 };
    const clients = [...(buckets.get(key)?.values() ?? [])].sort((x, y) => y.bps - x.bps || y.bytes - x.bytes);
    return { key, label, bytes: a.bytes, bps: a.bps, flows: a.flows, users: clients.length, clients };
  });

  const allIps = new Set<string>();
  for (const app of apps) for (const cl of app.clients) allIps.add(cl.ip);

  return {
    ...base,
    ok: true,
    error: flows.length ? null : "Belum ada data flow aktif dari ntopng.",
    iface: iface.name,
    apps,
    totalBytes: apps.reduce((s, a) => s + a.bytes, 0),
    totalBps: apps.reduce((s, a) => s + a.bps, 0),
    totalUsers: allIps.size,
    updatedAt: new Date().toISOString(),
  };
}
