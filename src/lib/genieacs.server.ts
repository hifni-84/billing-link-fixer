/**
 * Klien NBI GenieACS (default http://127.0.0.1:7557) untuk mengelola ONU:
 * WAN/PPPoE, VLAN, SSID & password WiFi, reboot, dsb.
 */

export type AcsClient = {
  mac: string;
  hostname: string;
  ip: string;
  signal: string;
};

export type AcsWifi = {
  index: string;
  band: string;
  ssid: string;
  ssidPath: string;
  key: string;
  keyPath: string | null;
  enabled: boolean | null;
  enablePath: string | null;
  clients: AcsClient[];
};

export type AcsWan = {
  index: string;
  path: string;
  kind: "ppp" | "ip";
  username: string;
  usernamePath: string | null;
  passwordPath: string | null;
  vlan: string;
  vlanPath: string | null;
  connectionStatus: string;
  externalIp: string;
  enabled: boolean | null;
  enablePath: string | null;
};

export type AcsDevice = {
  id: string;
  serial: string;
  manufacturer: string;
  model: string;
  softwareVersion: string;
  lastInform: string;
  online: boolean;
  ip: string;
  ppp: string;
  ssids: string[];
  clientCount: number;
};

export type AcsDeviceDetail = AcsDevice & {
  wifi: AcsWifi[];
  wan: AcsWan[];
  params: Record<string, string>;
};

export type AcsParamWrite = { path: string; value: string; type?: string };

function base(nbiUrl?: string) {
  const raw = ((nbiUrl && nbiUrl.trim()) || process.env["GENIEACS_NBI_URL"] || "http://127.0.0.1:7557").trim();
  const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withProto.replace(/\/+$/, "");
}

async function nbi(nbiUrl: string | undefined, path: string, init?: RequestInit) {
  const url = `${base(nbiUrl)}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `GenieACS NBI ${res.status}: ${text.slice(0, 200) || "tidak ada pesan"} (${url})`,
    );
  }
  return text ? (JSON.parse(text) as unknown) : null;
}

/** Ubah dokumen device GenieACS menjadi map path -> value (hanya leaf ber-_value). */
function flatten(node: unknown, prefix: string, out: Record<string, string>) {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if ("_value" in obj) {
    const v = obj["_value"];
    out[prefix] = v === null || v === undefined ? "" : String(v);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("_")) continue;
    if (!v || typeof v !== "object") continue;
    flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

function paramsOf(doc: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith("_") || !v || typeof v !== "object") continue;
    flatten(v, k, out);
  }
  return out;
}

function pick(params: Record<string, string>, re: RegExp) {
  for (const [k, v] of Object.entries(params)) if (re.test(k)) return { path: k, value: v };
  return null;
}

/** Kumpulkan nama SSID aktif (unik, tanpa yang kosong). */
function ssidsOf(params: Record<string, string>) {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (!/(WLANConfiguration\.\d+\.SSID|WiFi\.SSID\.\d+\.SSID)$/.test(k)) continue;
    const name = (v ?? "").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

type HostRow = {
  mac: string;
  hostname: string;
  ip: string;
  active: boolean;
  iface: string;
  wireless: boolean;
};

/** Baca tabel Hosts.Host.* (TR-098 & TR-181) menjadi daftar host. */
function hostsOf(params: Record<string, string>): HostRow[] {
  const roots = new Set<string>();
  for (const k of Object.keys(params)) {
    const m = /^(.*Hosts\.Host\.\d+)\./.exec(k);
    if (m) roots.add(m[1]!);
  }
  const rows: HostRow[] = [];
  for (const r of roots) {
    const get = (leafRe: RegExp) => {
      for (const [k, v] of Object.entries(params)) {
        if (!k.startsWith(`${r}.`)) continue;
        if (leafRe.test(k.slice(r.length + 1))) return v;
      }
      return "";
    };
    const mac = get(/^(PhysAddress|MACAddress)$/i);
    if (!mac) continue;
    const activeRaw = get(/^Active$/i);
    const iface =
      get(/^(Layer1Interface|InterfaceType|X_.*InterfaceType|AssociatedDevice)$/i) || "";
    const wireless = /wlan|wifi|wi-fi|802\.11|wireless/i.test(iface);
    rows.push({
      mac,
      hostname: get(/^(HostName|X_.*HostName)$/i),
      ip: get(/^(IPAddress|IPv4Address\.\d+\.IPAddress)$/i),
      active: activeRaw === "" ? true : activeRaw === "true" || activeRaw === "1",
      iface,
      wireless,
    });
  }
  return rows;
}

/** Ambil daftar klien WiFi di bawah satu root WLAN (AssociatedDevice + tabel Hosts). */
function clientsOf(params: Record<string, string>, root: string): AcsClient[] {
  const byMac = new Map<string, AcsClient>();
  const esc = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${esc}\\.(?:AssociatedDevice|X_[^.]*AssociatedDevice)\\.(\\d+)\\.(.+)$`);
  const byIndex = new Map<string, AcsClient>();
  for (const [k, v] of Object.entries(params)) {
    const m = re.exec(k);
    if (!m) continue;
    const idx = m[1]!;
    const leaf = m[2]!;
    const c = byIndex.get(idx) ?? { mac: "", hostname: "", ip: "", signal: "" };
    if (/(MACAddress|MacAddress|PhysAddress)$/i.test(leaf)) c.mac = v;
    else if (/(HostName|Host_?Name)$/i.test(leaf)) c.hostname = v;
    else if (/IPAddress$/i.test(leaf)) c.ip = v;
    else if (/(SignalStrength|RSSI|Noise)$/i.test(leaf)) c.signal = c.signal || v;
    byIndex.set(idx, c);
  }

  const hosts = hostsOf(params);
  const hostByMac = new Map(hosts.map((h) => [h.mac.toUpperCase(), h]));

  for (const c of byIndex.values()) {
    if (!c.mac) continue;
    const h = hostByMac.get(c.mac.toUpperCase());
    byMac.set(c.mac.toUpperCase(), {
      ...c,
      hostname: c.hostname || h?.hostname || "",
      ip: c.ip || h?.ip || "",
    });
  }

  // Banyak ONT tidak mengisi AssociatedDevice, tapi tabel Hosts menyebut interface WLAN-nya.
  const idx = root.split(".").pop() ?? "";
  for (const h of hosts) {
    if (!h.active) continue;
    const key = h.mac.toUpperCase();
    if (byMac.has(key)) continue;
    const matchIface =
      h.iface.includes(root) ||
      (h.wireless && (new RegExp(`(WLANConfiguration|SSID|AccessPoint)\\.${idx}\\b`).test(h.iface) || !/\d/.test(h.iface)));
    if (!matchIface) continue;
    byMac.set(key, { mac: h.mac, hostname: h.hostname, ip: h.ip, signal: "" });
  }

  return [...byMac.values()];
}

/** Jumlah perangkat yang benar-benar terhubung (WiFi + LAN) pada satu ONU. */
function clientCountOf(params: Record<string, string>) {
  const macs = new Set<string>();
  for (const [k, v] of Object.entries(params)) {
    if (!/AssociatedDevice\.\d+\.[^.]*(MACAddress|MacAddress|PhysAddress)$/i.test(k)) continue;
    if (v) macs.add(v.toUpperCase());
  }
  for (const h of hostsOf(params)) {
    if (h.active && h.mac) macs.add(h.mac.toUpperCase());
  }
  if (macs.size) return macs.size;
  let total = 0;
  for (const [k, v] of Object.entries(params)) {
    if (/(TotalAssociations|AssociatedDeviceNumberOfEntries|HostNumberOfEntries)$/i.test(k)) {
      total = Math.max(total, Number(v) || 0);
    }
  }
  return total;
}


function summarize(doc: Record<string, unknown>, params: Record<string, string>): AcsDevice {
  const id = String(doc["_id"] ?? "");
  const lastInformRaw = (doc["_lastInform"] ?? doc["_registered"]) as string | number | undefined;
  const lastInform = lastInformRaw ? new Date(lastInformRaw).toISOString() : "";
  const online = lastInform ? Date.now() - new Date(lastInform).getTime() < 10 * 60 * 1000 : false;
  const ip =
    pick(params, /WANIPConnection\.\d+\.ExternalIPAddress$/)?.value ||
    pick(params, /WANPPPConnection\.\d+\.ExternalIPAddress$/)?.value ||
    pick(params, /\.ManagementServer\.ConnectionRequestURL$/)?.value.replace(
      /^https?:\/\/([^:/]+).*/,
      "$1",
    ) ||
    "";
  return {
    id,
    serial: pick(params, /DeviceInfo\.SerialNumber$/)?.value || id.split("-").pop() || id,
    manufacturer: pick(params, /DeviceInfo\.Manufacturer$/)?.value || "",
    model:
      pick(params, /DeviceInfo\.(ModelName|ProductClass)$/)?.value || id.split("-")[1] || "",
    softwareVersion: pick(params, /DeviceInfo\.SoftwareVersion$/)?.value || "",
    lastInform,
    online,
    ip,
    ppp: pick(params, /WANPPPConnection\.\d+\.Username$/)?.value || "",
    ssids: ssidsOf(params),
    clientCount: clientCountOf(params),
  };
}

export async function acsListDevices(nbiUrl?: string): Promise<AcsDevice[]> {
  const projection = [
    "_id",
    "_lastInform",
    "InternetGatewayDevice.DeviceInfo.SerialNumber",
    "InternetGatewayDevice.DeviceInfo.Manufacturer",
    "InternetGatewayDevice.DeviceInfo.ModelName",
    "InternetGatewayDevice.DeviceInfo.ProductClass",
    "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
    "InternetGatewayDevice.WANDevice",
    "Device.DeviceInfo.SerialNumber",
    "Device.DeviceInfo.Manufacturer",
    "Device.DeviceInfo.ModelName",
    "Device.DeviceInfo.SoftwareVersion",
    "Device.PPP",
    "Device.IP",
    "InternetGatewayDevice.LANDevice",
    "Device.WiFi",
    "Device.Hosts",
  ].join(",");
  const rows = (await nbi(nbiUrl, `/devices/?projection=${encodeURIComponent(projection)}`)) as
    | Record<string, unknown>[]
    | null;
  return (rows ?? []).map((d) => summarize(d, paramsOf(d)));
}

export async function acsGetDevice(id: string, nbiUrl?: string): Promise<AcsDeviceDetail> {
  const query = encodeURIComponent(JSON.stringify({ _id: id }));
  const rows = (await nbi(nbiUrl, `/devices/?query=${query}`)) as
    | Record<string, unknown>[]
    | null;
  const doc = rows?.[0];
  if (!doc) throw new Error("Perangkat tidak ditemukan di GenieACS");
  const params = paramsOf(doc);

  // ---- WiFi (TR-098 WLANConfiguration & TR-181 WiFi.SSID) ----
  const wifi: AcsWifi[] = [];
  for (const [path, value] of Object.entries(params)) {
    const m098 = /^(.*WLANConfiguration\.(\d+))\.SSID$/.exec(path);
    const m181 = /^(.*WiFi\.SSID\.(\d+))\.SSID$/.exec(path);
    const m = m098 ?? m181;
    if (!m) continue;
    const root = m[1]!;
    const index = m[2]!;
    let keyPath: string | null = null;
    for (const cand of [
      `${root}.KeyPassphrase`,
      `${root}.PreSharedKey.1.KeyPassphrase`,
      `${root}.PreSharedKey.1.PreSharedKey`,
    ]) {
      if (cand in params) {
        keyPath = cand;
        break;
      }
    }
    if (!keyPath && m181) {
      const ap = Object.keys(params).find((k) =>
        new RegExp(`WiFi\\.AccessPoint\\.${index}\\.Security\\.KeyPassphrase$`).test(k),
      );
      if (ap) keyPath = ap;
    }
    const enablePath = `${root}.Enable` in params ? `${root}.Enable` : null;
    const band =
      params[`${root}.OperatingFrequencyBand`] ||
      params[`${root}.Standard`] ||
      (Number(index) >= 5 ? "5 GHz" : "2.4 GHz");
    wifi.push({
      index,
      band,
      ssid: value,
      ssidPath: path,
      key: keyPath ? (params[keyPath] ?? "") : "",
      keyPath,
      enabled: enablePath ? params[enablePath] === "true" || params[enablePath] === "1" : null,
      enablePath,
      clients: clientsOf(params, root),
    });
  }

  // ---- WAN ----
  const wan: AcsWan[] = [];
  const wanRoots = new Set<string>();
  for (const path of Object.keys(params)) {
    const m = /^(.*(?:WANPPPConnection|WANIPConnection)\.\d+)\./.exec(path);
    if (m) wanRoots.add(m[1]!);
    const m2 = /^(Device\.(?:PPP\.Interface|IP\.Interface)\.\d+)\./.exec(path);
    if (m2) wanRoots.add(m2[1]!);
  }
  for (const root of [...wanRoots].sort()) {
    const kind: "ppp" | "ip" = /PPP/.test(root) ? "ppp" : "ip";
    const index = root.split(".").pop() ?? "1";
    const usernamePath = [`${root}.Username`].find((p) => p in params) ?? null;
    const passwordPath = [`${root}.Password`].find((p) => p in params) ?? null;
    const vlanPath =
      [
        `${root}.X_HW_VLAN`,
        `${root}.X_CT-COM_VLAN`,
        `${root}.X_CT-COM_LanInterface`,
        `${root}.VLANIDMark`,
        `${root}.X_ZTE-COM_VLANID`,
      ].find((p) => p in params) ??
      Object.keys(params).find((k) => k.startsWith(`${root}.`) && /VLAN/i.test(k)) ??
      null;
    wan.push({
      index,
      path: root,
      kind,
      username: usernamePath ? (params[usernamePath] ?? "") : "",
      usernamePath,
      passwordPath,
      vlan: vlanPath ? (params[vlanPath] ?? "") : "",
      vlanPath,
      connectionStatus: params[`${root}.ConnectionStatus`] || params[`${root}.Status`] || "",
      externalIp: params[`${root}.ExternalIPAddress`] || "",
      enabled:
        `${root}.Enable` in params
          ? params[`${root}.Enable`] === "true" || params[`${root}.Enable`] === "1"
          : null,
      enablePath: `${root}.Enable` in params ? `${root}.Enable` : null,
    });
  }

  return { ...summarize(doc, params), wifi, wan, params };
}

function taskUrl(id: string, connectionRequest: boolean) {
  return `/devices/${encodeURIComponent(id)}/tasks${connectionRequest ? "?connection_request" : ""}`;
}

function guessType(value: string, explicit?: string) {
  if (explicit) return explicit;
  if (value === "true" || value === "false") return "xsd:boolean";
  if (/^\d+$/.test(value)) return "xsd:unsignedInt";
  return "xsd:string";
}

/** Tulis beberapa parameter sekaligus ke satu perangkat. */
export async function acsSetParams(id: string, writes: AcsParamWrite[], nbiUrl?: string) {
  if (!writes.length) throw new Error("Tidak ada parameter yang diubah");
  await nbi(nbiUrl, taskUrl(id, true), {
    method: "POST",
    body: JSON.stringify({
      name: "setParameterValues",
      parameterValues: writes.map((w) => [w.path, w.value, guessType(w.value, w.type)]),
    }),
  });
  return { ok: true as const };
}

/** Tambah instance objek baru, mis. WAN baru (addObject). */
export async function acsAddObject(id: string, objectName: string, nbiUrl?: string) {
  await nbi(nbiUrl, taskUrl(id, true), {
    method: "POST",
    body: JSON.stringify({ name: "addObject", objectName }),
  });
  return { ok: true as const };
}

export async function acsDeleteObject(id: string, objectName: string, nbiUrl?: string) {
  await nbi(nbiUrl, taskUrl(id, true), {
    method: "POST",
    body: JSON.stringify({ name: "deleteObject", objectName }),
  });
  return { ok: true as const };
}

export async function acsAction(
  id: string,
  action: "reboot" | "factoryReset" | "refresh",
  nbiUrl?: string,
) {
  const body =
    action === "refresh"
      ? { name: "refreshObject", objectName: "" }
      : { name: action === "reboot" ? "reboot" : "factoryReset" };
  await nbi(nbiUrl, taskUrl(id, true), { method: "POST", body: JSON.stringify(body) });
  return { ok: true as const };
}
