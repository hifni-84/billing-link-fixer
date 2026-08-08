/**
 * Manajemen VPN L2TP/IPsec dari panel billing.
 * Dipakai untuk MikroTik RouterOS v6 yang tidak mendukung WireGuard.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { promisify } from "node:util";

import { query } from "./radius.server";

const exec = promisify(execFile);

const L2TP_NET = process.env["L2TP_NET"] ?? "10.30.30";
const CHAP = "/etc/ppp/chap-secrets";
const PSK_FILE = "/etc/billing-l2tp.psk";
const PPP_NAME = "l2tpd";

export type L2tpPeer = {
  id: number;
  name: string;
  peer_ip: string;
  username: string;
  password: string;
  secret: string;
  created_at: string | null;
};

export type L2tpServerInfo = {
  ready: boolean;
  network: string;
  serverIp: string;
  psk: string | null;
  endpoint: string;
  ipsecUp: boolean;
  l2tpUp: boolean;
  writable: boolean;
  error: string | null;
};

async function run(cmd: string, args: string[]) {
  try {
    return (await exec(cmd, args)).stdout;
  } catch {
    return (await exec("sudo", ["-n", cmd, ...args])).stdout;
  }
}

async function readFileSafe(path: string): Promise<string> {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return await run("cat", [path]);
  }
}

async function writeChap(text: string) {
  try {
    await fs.writeFile(CHAP, text, { mode: 0o600 });
  } catch {
    const tmp = "/tmp/chap-secrets.billing";
    await fs.writeFile(tmp, text, { mode: 0o600 });
    await run("install", ["-m", "600", tmp, CHAP]);
  }
}

async function isActive(unit: string) {
  try {
    return (await run("systemctl", ["is-active", unit])).trim() === "active";
  } catch {
    return false;
  }
}

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await query(
    `CREATE TABLE IF NOT EXISTS l2tp_peer (
       id INT AUTO_INCREMENT PRIMARY KEY,
       name VARCHAR(64) NOT NULL UNIQUE,
       peer_ip VARCHAR(45) NOT NULL,
       username VARCHAR(64) NOT NULL,
       password VARCHAR(64) NOT NULL,
       secret VARCHAR(64) NOT NULL DEFAULT 'rahasia123',
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  tableReady = true;
}

export async function l2tpListPeers(): Promise<L2tpPeer[]> {
  await ensureTable();
  return query<L2tpPeer>(
    "SELECT id, name, peer_ip, username, password, secret, created_at FROM l2tp_peer ORDER BY id",
  );
}

export async function l2tpServerInfo(): Promise<L2tpServerInfo> {
  const info: L2tpServerInfo = {
    ready: false,
    network: `${L2TP_NET}.0/24`,
    serverIp: `${L2TP_NET}.1`,
    psk: null,
    endpoint: "",
    ipsecUp: false,
    l2tpUp: false,
    writable: false,
    error: null,
  };

  try {
    await readFileSafe("/etc/xl2tpd/xl2tpd.conf");
    info.ready = true;
  } catch (e) {
    info.error = e instanceof Error ? e.message : "Server L2TP belum disiapkan";
  }

  try {
    info.psk = (await readFileSafe(PSK_FILE)).trim() || null;
  } catch {
    try {
      const sec = await readFileSafe("/etc/ipsec.secrets");
      info.psk = /PSK\s+"([^"]+)"/.exec(sec)?.[1] ?? null;
    } catch {
      /* biarkan null */
    }
  }

  try {
    await readFileSafe(CHAP);
    info.writable = true;
  } catch {
    info.writable = false;
  }

  info.l2tpUp = await isActive("xl2tpd");
  info.ipsecUp = (await isActive("strongswan-starter")) || (await isActive("strongswan"));

  // endpoint mengikuti pengaturan WireGuard agar satu sumber kebenaran
  try {
    const { wgGetEndpointOverride } = await import("./wireguard.server");
    info.endpoint = (await wgGetEndpointOverride()) || (process.env["PUBLIC_HOST"] ?? "");
  } catch {
    info.endpoint = process.env["PUBLIC_HOST"] ?? "";
  }
  if (!info.endpoint) {
    try {
      const res = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(4000) });
      info.endpoint = (await res.text()).trim();
    } catch {
      info.endpoint = "IP_PUBLIK_ATAU_DDNS_SERVER";
    }
  }

  return info;
}

/** Skrip MikroTik RouterOS v6 (juga jalan di v7). */
export function l2tpMikrotikScript(p: {
  endpoint: string;
  username: string;
  password: string;
  psk: string;
  serverIp: string;
  network: string;
  secret: string;
}) {
  return `# ==== L2TP/IPsec ke server billing (RouterOS v6 & v7) ====
/interface l2tp-client
add name=l2tp-billing connect-to=${p.endpoint} user="${p.username}" password="${p.password}" \\
    profile=default-encryption ipsec-secret="${p.psk}" use-ipsec=yes \\
    add-default-route=no disabled=no keepalive-timeout=30

# API supaya billing bisa kelola user & sesi
/ip service set www disabled=no
/ip service set api disabled=no

/ip firewall filter
add chain=input in-interface=l2tp-billing action=accept comment="L2TP Billing" place-before=0

/radius
add address=${p.serverIp} secret=${p.secret} service=hotspot,ppp timeout=3s
/ip hotspot profile set [find] use-radius=yes
/ppp aaa set use-radius=yes

# Cek dari router: harus reply
/ping ${p.serverIp} count=3`;
}

function chapLine(username: string, password: string, ip: string) {
  return `"${username}"\t${PPP_NAME}\t"${password}"\t${ip}`;
}

export async function l2tpAddPeer(input: {
  name: string;
  secret?: string;
  registerNas?: boolean;
}) {
  await ensureTable();
  const name = input.name.trim().replace(/\s+/g, "-");
  if (!name) throw new Error("Nama router wajib diisi");

  const peers = await l2tpListPeers();
  if (peers.some((p) => p.name === name)) throw new Error(`Router "${name}" sudah ada`);

  const secret = (input.secret ?? "").trim() || "rahasia123";
  const used = new Set<number>([1]);
  for (const p of peers) {
    const n = Number(p.peer_ip.split(".").pop());
    if (Number.isFinite(n)) used.add(n);
  }
  let next = 10;
  while (used.has(next)) next += 1;
  if (next > 200) throw new Error("Kuota IP tunnel L2TP penuh");
  const peerIp = `${L2TP_NET}.${next}`;

  const username = `${name}-vpn`;
  const password = crypto.randomBytes(9).toString("base64").replace(/[/+=]/g, "");

  let chap = "";
  try {
    chap = await readFileSafe(CHAP);
  } catch {
    throw new Error(
      "Server L2TP belum disiapkan. Jalankan sekali di server: sudo bash deploy/install-l2tp.sh",
    );
  }
  const bersih = chap
    .split("\n")
    .filter((l) => !new RegExp(`^"?${username}"?\\s`).test(l.trim()))
    .join("\n")
    .replace(/\s*$/, "\n");
  let applied = true;
  let applyError: string | null = null;
  try {
    await writeChap(`${bersih}${chapLine(username, password, peerIp)}\n`);
  } catch (e) {
    applied = false;
    applyError = e instanceof Error ? e.message : "gagal menulis daftar user L2TP";
  }

  await query(
    "INSERT INTO l2tp_peer (name, peer_ip, username, password, secret) VALUES (?,?,?,?,?)",
    [name, peerIp, username, password, secret],
  );

  if (input.registerNas !== false) {
    try {
      const { saveNas } = await import("./radius.server");
      await saveNas({
        nasname: peerIp,
        shortname: name,
        secret,
        description: `L2TP ${name}`,
      });
    } catch {
      /* bisa ditambah manual di Pengaturan */
    }
  }

  const info = await l2tpServerInfo();
  return {
    ok: true as const,
    name,
    peerIp,
    applied,
    applyError,
    script: l2tpMikrotikScript({
      endpoint: info.endpoint,
      username,
      password,
      psk: info.psk ?? "PSK_SERVER",
      serverIp: info.serverIp,
      network: info.network,
      secret,
    }),
  };
}

export async function l2tpPeerScript(id: number) {
  const peers = await l2tpListPeers();
  const p = peers.find((x) => x.id === id);
  if (!p) throw new Error("Router tidak ditemukan");
  const info = await l2tpServerInfo();
  return {
    name: p.name,
    peerIp: p.peer_ip,
    script: l2tpMikrotikScript({
      endpoint: info.endpoint,
      username: p.username,
      password: p.password,
      psk: info.psk ?? "PSK_SERVER",
      serverIp: info.serverIp,
      network: info.network,
      secret: p.secret,
    }),
  };
}

export async function l2tpDeletePeer(id: number) {
  await ensureTable();
  const peers = await l2tpListPeers();
  const p = peers.find((x) => x.id === id);
  if (!p) return { ok: true as const };

  try {
    const chap = await readFileSafe(CHAP);
    const bersih = chap
      .split("\n")
      .filter((l) => !new RegExp(`^"?${p.username}"?\\s`).test(l.trim()))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    await writeChap(bersih.replace(/\s*$/, "\n"));
  } catch {
    /* file tidak bisa dibaca/ditulis */
  }
  await query("DELETE FROM l2tp_peer WHERE id = ?", [id]);
  try {
    await query("DELETE FROM nas WHERE nasname = ?", [p.peer_ip]);
  } catch {
    /* abaikan */
  }
  return { ok: true as const };
}

/** Router dianggap online bila IP tunnel-nya membalas ping. */
export async function l2tpOnlineMap(): Promise<Record<string, boolean>> {
  const peers = await l2tpListPeers().catch(() => [] as L2tpPeer[]);
  const out: Record<string, boolean> = {};
  await Promise.all(
    peers.map(async (p) => {
      try {
        await exec("ping", ["-c", "1", "-W", "1", p.peer_ip], { timeout: 3000 });
        out[p.peer_ip] = true;
      } catch {
        out[p.peer_ip] = false;
      }
    }),
  );
  return out;
}

export async function l2tpTestPeer(
  id: number,
  creds?: { username?: string; password?: string; port?: number; useHttps?: boolean },
) {
  const peers = await l2tpListPeers();
  const p = peers.find((x) => x.id === id);
  if (!p) throw new Error("Router tidak ditemukan");

  const info = await l2tpServerInfo();
  let inChap = false;
  try {
    inChap = (await readFileSafe(CHAP)).includes(p.username);
  } catch {
    inChap = false;
  }
  let online = false;
  try {
    await exec("ping", ["-c", "1", "-W", "1", p.peer_ip], { timeout: 3000 });
    online = true;
  } catch {
    online = false;
  }

  const { callRouterOs } = await import("./mikrotik.server");
  const res = creds?.username
    ? await callRouterOs(
        {
          host: p.peer_ip,
          username: creds.username,
          password: creds.password ?? "",
          ...(creds.port !== undefined ? { port: creds.port } : {}),
          ...(creds.useHttps !== undefined ? { useHttps: creds.useHttps } : {}),
        },
        "/system/identity",
        "GET",
      )
    : null;

  const saran: string[] = [];
  if (!info.ipsecUp || !info.l2tpUp)
    saran.push(
      "Service VPN belum jalan di server. Jalankan: sudo bash deploy/install-l2tp.sh lalu sudo bash deploy/allow-l2tp-sudo.sh",
    );
  if (!inChap)
    saran.push(`User ${p.username} belum ada di ${CHAP} — hapus lalu tambah ulang router ini.`);
  if (!online)
    saran.push(
      "Router belum tersambung: pastikan skrip sudah dijalankan di router, port UDP 500/4500/1701 terbuka, dan IPsec secret sama dengan PSK di panel.",
    );
  if (online && res && !res.ok)
    saran.push(
      "Tunnel tersambung tapi API gagal: aktifkan /ip service set www disabled=no dan izinkan chain=input in-interface=l2tp-billing, serta cek user/password router di Pengaturan.",
    );
  if (online && !res)
    saran.push("Isi user & password router di menu Pengaturan agar API bisa diuji.");

  return {
    name: p.name,
    peerIp: p.peer_ip,
    inChap,
    online,
    api: Boolean(res?.ok),
    apiError: res && !res.ok ? (res.error ?? "gagal") : null,
    saran,
  };
}
