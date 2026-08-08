/**
 * Penerapan domain / IP publik ke Nginx + SSL langsung dari menu Pengaturan,
 * supaya admin tidak perlu mengetik perintah di server lagi.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { getSettings, saveSettings } from "./radius.server";

const exec = promisify(execFile);

const APP_DIR = process.env["BILLING_DIR"] ?? "/opt/mikrotik-billing";
const SCRIPT = path.join(APP_DIR, "deploy", "apply-domain.sh");
const SUDO_HELPER = path.join(APP_DIR, "deploy", "allow-domain-sudo.sh");

export const domainKeys = {
  list: "billing.public.domains",
  email: "billing.public.ssl_email",
  port: "billing.public.app_port",
  host: "billing.public.host",
  https: "billing.public.https",
};

export type DomainOptions = {
  domains: string[];
  email: string;
  port: string;
  https: boolean;
};

export type DomainStatus = {
  ready: boolean;
  scriptFound: boolean;
  sudoAllowed: boolean;
  setupCommand: string;
  options: DomainOptions;
  publicIp: string | null;
  suggestedDomain: string | null;
  certs: { domain: string; installed: boolean }[];
  error: string | null;
};

/** Bersihkan input jadi nama host saja (tanpa skema / path / port). */
export function cleanHost(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

export function isValidHost(host: string) {
  if (!host || host.length > 253) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host);
}

export async function domainOptions(): Promise<DomainOptions> {
  const s = await getSettings();
  const raw = s[domainKeys.list] ?? s[domainKeys.host] ?? "";
  const domains = raw
    .split(",")
    .map(cleanHost)
    .filter((d) => d.length > 0);
  return {
    domains: [...new Set(domains)],
    email: s[domainKeys.email] ?? "",
    port: (s[domainKeys.port] ?? "3000").trim() || "3000",
    https: s[domainKeys.https] === "1",
  };
}

async function sudoAllowed() {
  try {
    await exec("sudo", ["-n", "-l", SCRIPT], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Deteksi IP publik server (untuk saran domain gratis sslip.io). */
export async function detectPublicIp(): Promise<string | null> {
  const urls = ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"];
  for (const url of urls) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const ip = (await res.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
    } catch {
      // coba sumber berikutnya
    }
  }
  return null;
}

/** Cek apakah sertifikat Let's Encrypt sudah terpasang untuk tiap domain. */
async function certState(domains: string[]) {
  return Promise.all(
    domains.map(async (domain) => {
      try {
        await fs.access(`/etc/letsencrypt/live/${domain}`);
        return { domain, installed: true };
      } catch {
        return { domain, installed: false };
      }
    }),
  );
}

export async function domainStatus(): Promise<DomainStatus> {
  const options = await domainOptions();
  let scriptFound = false;
  try {
    await fs.access(SCRIPT);
    scriptFound = true;
  } catch {
    scriptFound = false;
  }
  const allowed = scriptFound ? await sudoAllowed() : false;
  const publicIp = await detectPublicIp();
  const certs = await certState(options.domains);
  return {
    ready: scriptFound && allowed,
    scriptFound,
    sudoAllowed: allowed,
    setupCommand: `sudo bash ${SUDO_HELPER}`,
    options,
    publicIp,
    suggestedDomain: publicIp ? `${publicIp.replace(/\./g, "-")}.sslip.io` : null,
    certs,
    error: null,
  };
}

/** Simpan daftar domain dan terapkan ke Nginx (+ SSL bila diminta). */
export async function domainApply(input: DomainOptions): Promise<{ ok: boolean; log: string }> {
  const domains = [...new Set(input.domains.map(cleanHost).filter(Boolean))];
  if (domains.length === 0) throw new Error("Isi minimal satu IP publik atau nama domain");
  for (const d of domains) {
    if (!isValidHost(d)) throw new Error(`Alamat tidak valid: ${d}`);
  }
  const port = /^\d{2,5}$/.test(input.port.trim()) ? input.port.trim() : "3000";
  const email = input.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Format email tidak valid");
  }

  await saveSettings({
    [domainKeys.list]: domains.join(","),
    [domainKeys.email]: email,
    [domainKeys.port]: port,
    [domainKeys.https]: input.https ? "1" : "0",
    // domain pertama dipakai untuk link tagihan WhatsApp
    [domainKeys.host]: domains[0] ?? "",
  });

  try {
    await fs.access(SCRIPT);
  } catch {
    throw new Error(`Skrip ${SCRIPT} tidak ditemukan di server`);
  }
  if (!(await sudoAllowed())) {
    throw new Error(
      `Izin sudo belum diberikan. Jalankan sekali di server: sudo bash ${SUDO_HELPER}`,
    );
  }

  const args = [
    "-n",
    SCRIPT,
    domains.join(","),
    email,
    port,
    input.https ? "1" : "0",
  ];
  try {
    const { stdout, stderr } = await exec("sudo", args, {
      timeout: 300_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true, log: `${stdout}${stderr}`.trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const log = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || err.message || "Gagal";
    return { ok: false, log };
  }
}
