/**
 * Manajemen VPN SSTP dari panel billing.
 * SSTP berjalan di TCP (default 8443) sehingga tidak butuh UDP/IPsec —
 * cocok untuk MikroTik RouterOS v6 di jaringan yang membatasi port.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { promisify } from "node:util";

import { query } from "./radius.server";

const exec = promisify(execFile);

const SSTP_NET = process.env["SSTP_NET"] ?? "10.40.40";
const CHAP = "/etc/ppp/chap-secrets";
const PPP_NAME = "*";

export type SstpPeer = {
  id: number;
  name: string;
  peer_ip: string;
  username: string;
  password: string;
  secret: string;
  created_at: string | null;
};

export type SstpServerInfo = {
  ready: boolean;
  network: string;
  serverIp: string;
  endpoint: string;
  port: number;
  serviceUp: boolean;
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
    `CREATE TABLE IF NOT EXISTS sstp_peer (
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

export async function sstpListPeers(): Promise<SstpPeer[]> {
  await ensureTable();
  return query<SstpPeer>(
    "SELECT id, name, peer_ip, username, password, secret, created_at FROM sstp_peer ORDER BY id",
  );
}

export async function sstpServerInfo(): Promise<SstpServerInfo> {
  const info: SstpServerInfo = {
    ready: false,
    network: `${SSTP_NET}.0/24`,
    serverIp: `${SSTP_NET}.1`,
    endpoint: "",
    port: 8443,
    serviceUp: false,
    writable: false,
    error: null,
  };

  try {
    await readFileSafe("/etc/ppp/options.sstpd");
    info.ready = true;
  } catch (e) {
    info.error = e instanceof Error ? e.message : "Server SSTP belum disiapkan";
  }

  try {
    const raw = await readFileSafe("/etc/billing-sstp-port");
    const p = parseInt(raw.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(p) && p > 0) info.port = p;
  } catch {
    /* pakai default */
  }

  try {
    await readFileSafe(CHAP);
    info.writable = true;
  } catch {
    info.writable = false;
  }

  info.serviceUp = await isActive("billing-sstp");

  try {
    const { wgGetEndpointOverride } = await import("./wireguard.server");
    info.endpoint = (await wgGetEndpointOverride()) || (process.env["PUBLIC_HOST"] ?? "");
  } catch {
    info.endpoint = process.env["PUBLIC_HOST"] ?? "";
  }
  if (!info.endpoint) {
    try {
      info.endpoint = (await readFileSafe("/etc/billing-vpn-host")).trim();
    } catch {
      /* abaikan */
    }
  }
  if (!info.endpoint) {
    try {
      const res = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(4000) });
      info.endpoint = (await res.text()).trim();
    } catch {
      info.endpoint = "IP_PUBLIK_ATAU_DOMAIN_SERVER";
    }
  }

  return info;
}

/** Skrip MikroTik RouterOS v6 & v7 untuk SSTP client. */
export function sstpMikrotikScript(p: {
  endpoint: string;
  port: number;
  username: string;
  password: string;
  serverIp: string;
  secret: string;
}) {
  return `# ==== SSTP ke server billing (RouterOS v6 & v7) ====
# SSTP memakai TCP ${p.port} sehingga tidak perlu port-forward UDP.
# Hapus konfigurasi lama agar skrip aman dijalankan ulang.
/interface sstp-client remove [find name="sstp-billing"]
/interface sstp-client
add name=sstp-billing connect-to=${p.endpoint}:${p.port} user="${p.username}" \\
    password="${p.password}" profile=default-encryption \\
    verify-server-certificate=no add-default-route=no disabled=no keepalive-timeout=30

# API supaya billing bisa kelola user & sesi
/ip service set www disabled=no
/ip service set api disabled=no

/ip firewall filter
remove [find comment="SSTP Billing"]
add chain=input in-interface=sstp-billing action=accept comment="SSTP Billing" place-before=0

/radius
remove [find comment="SSTP Billing"]
add address=${p.serverIp} secret=${p.secret} service=hotspot,ppp timeout=3s comment="SSTP Billing"
/ip hotspot profile set [find] use-radius=yes
/ppp aaa set use-radius=yes

# Cek dari router: harus reply
/ping ${p.serverIp} count=3`;
}

function chapLine(username: string, password: string, ip: string) {
  return `"${username}"\t${PPP_NAME}\t"${password}"\t${ip}`;
}

export async function sstpAddPeer(input: {
  name: string;
  secret?: string;
  registerNas?: boolean;
}) {
  await ensureTable();
  const name = input.name.trim().replace(/\s+/g, "-");
  if (!name) throw new Error("Nama router wajib diisi");

  const peers = await sstpListPeers();
  if (peers.some((p) => p.name === name)) throw new Error(`Router "${name}" sudah ada`);

  const secret = (input.secret ?? "").trim() || "rahasia123";
  const used = new Set<number>([1]);
  for (const p of peers) {
    const n = Number(p.peer_ip.split(".").pop());
    if (Number.isFinite(n)) used.add(n);
  }
  let next = 10;
  while (used.has(next)) next += 1;
  if (next > 200) throw new Error("Kuota IP tunnel SSTP penuh");
  const peerIp = `${SSTP_NET}.${next}`;

  const username = `${name}-sstp`;
  const password = crypto.randomBytes(9).toString("base64").replace(/[/+=]/g, "");

  let chap = "";
  try {
    chap = await readFileSafe(CHAP);
  } catch {
    throw new Error(
      "Server SSTP belum disiapkan. Jalankan sekali di server: sudo bash deploy/install-sstp.sh",
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
    applyError = e instanceof Error ? e.message : "gagal menulis daftar user SSTP";
  }

  await query(
    "INSERT INTO sstp_peer (name, peer_ip, username, password, secret) VALUES (?,?,?,?,?)",
    [name, peerIp, username, password, secret],
  );

  if (input.registerNas !== false) {
    try {
      const { saveNas } = await import("./radius.server");
      await saveNas({
        nasname: peerIp,
        shortname: name,
        secret,
        description: `SSTP ${name}`,
      });
    } catch {
      /* bisa ditambah manual di Pengaturan */
    }
  }

  const info = await sstpServerInfo();
  return {
    ok: true as const,
    name,
    peerIp,
    applied,
    applyError,
    script: sstpMikrotikScript({
      endpoint: info.endpoint,
      port: info.port,
      username,
      password,
      serverIp: info.serverIp,
      secret,
    }),
  };
}

export async function sstpPeerScript(id: number) {
  const peers = await sstpListPeers();
  const p = peers.find((x) => x.id === id);
  if (!p) throw new Error("Router tidak ditemukan");
  const info = await sstpServerInfo();
  return {
    name: p.name,
    peerIp: p.peer_ip,
    script: sstpMikrotikScript({
      endpoint: info.endpoint,
      port: info.port,
      username: p.username,
      password: p.password,
      serverIp: info.serverIp,
      secret: p.secret,
    }),
  };
}

export async function sstpDeletePeer(id: number) {
  await ensureTable();
  const peers = await sstpListPeers();
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
  await query("DELETE FROM sstp_peer WHERE id = ?", [id]);
  try {
    await query("DELETE FROM nas WHERE nasname = ?", [p.peer_ip]);
  } catch {
    /* abaikan */
  }
  return { ok: true as const };
}

/** Router dianggap online bila IP tunnel-nya membalas ping. */
export async function sstpOnlineMap(): Promise<Record<string, boolean>> {
  const peers = await sstpListPeers().catch(() => [] as SstpPeer[]);
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

export async function sstpTestPeer(
  id: number,
  creds?: { username?: string; password?: string; port?: number; useHttps?: boolean },
) {
  const peers = await sstpListPeers();
  const p = peers.find((x) => x.id === id);
  if (!p) throw new Error("Router tidak ditemukan");

  const info = await sstpServerInfo();
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
  if (!info.ready || !info.serviceUp)
    saran.push(
      "Server SSTP belum jalan. Jalankan: sudo bash deploy/install-sstp.sh lalu sudo bash deploy/allow-sstp-sudo.sh",
    );
  if (!inChap)
    saran.push(`User ${p.username} belum ada di ${CHAP} — hapus lalu tambah ulang router ini.`);
  if (!online)
    saran.push(
      "Router belum tersambung: jalankan ulang Config terbaru di router, lalu cek /interface sstp-client monitor sstp-billing once.",
    );
  if (!online)
    saran.push(
      `RouterOS v6: pastikan verify-server-certificate=no dan connect-to memakai host + port ${info.port}.`,
    );
  if (online && res && !res.ok)
    saran.push(
      "Tunnel tersambung tapi API gagal: aktifkan /ip service set www disabled=no dan izinkan chain=input in-interface=sstp-billing.",
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
