/**
 * Portal WiFi pelanggan PPPoE: verifikasi akun lalu baca/ubah SSID & password
 * WiFi pada ONT pelanggan melalui GenieACS (TR-069).
 */

import { getSettings, query } from "./radius.server";
import { acsGetDevice, acsListDevices, acsSetParams } from "./genieacs.server";

export type CustomerWifiBand = {
  index: string;
  band: string;
  ssid: string;
  ssidPath: string;
  keyPath: string | null;
};

export type CustomerWifiInfo = {
  username: string;
  plan: string;
  expiresAt: string | null;
  device: {
    id: string;
    model: string;
    manufacturer: string;
    online: boolean;
    lastInform: string;
  };
  bands: CustomerWifiBand[];
};

type VoucherRow = {
  username: string;
  plan: string | null;
  expires_at: string | null;
  disabled: number | null;
};

/** Verifikasi username + password PPPoE pelanggan di database billing. */
async function verifyCustomer(username: string, password: string) {
  const rows = await query<VoucherRow>(
    `SELECT username, plan, expires_at, disabled
       FROM billing_voucher
       WHERE LOWER(username) = LOWER(?) AND password = ? AND LOWER(service) = 'pppoe'
      LIMIT 1`,
    [username.trim(), password],
  );
  const row = rows[0];
  if (!row) throw new Error("Username atau password PPPoE salah.");
  if (row.disabled) throw new Error("Akun Anda sedang tidak aktif. Hubungi admin.");
  return row;
}

/** Cari ONT pelanggan di GenieACS berdasarkan username PPPoE-nya. */
async function findDevice(username: string) {
  const settings = await getSettings();
  const nbiUrl = settings["genieacs.nbiUrl"] || undefined;
  const devices = await acsListDevices(nbiUrl);
  const u = username.trim().toLowerCase();
  const matches = devices.filter((d) =>
    [d.ppp, ...(d.pppNames ?? [])].some((n) => (n || "").trim().toLowerCase() === u),
  );
  if (matches.length > 1) {
    throw new Error("Beberapa modem tertaut ke akun ini. Minta admin periksa User PPPoE dan tag modem di GenieACS.");
  }
  const target = matches[0];
  if (!target) {
    throw new Error(
      devices.length
        ? "Akun internet ditemukan, tetapi modem belum tertaut. Minta admin periksa User PPPoE atau tag modem di GenieACS."
        : "Belum ada modem terdaftar di sistem pengelolaan jarak jauh. Hubungi admin.",
    );
  }
  return acsGetDevice(target.id, nbiUrl);
}

const bandsOf = (detail: Awaited<ReturnType<typeof acsGetDevice>>) =>
  detail.wifi
    .filter((w) => w.ssidPath)
    .map<CustomerWifiBand>((w) => ({
      index: w.index,
      band: w.band || (Number(w.index) >= 5 ? "5 GHz" : "2.4 GHz"),
      ssid: w.ssid,
      ssidPath: w.ssidPath,
      keyPath: w.keyPath,
    }));

export async function customerWifiInfo(
  username: string,
  password: string,
): Promise<CustomerWifiInfo> {
  const row = await verifyCustomer(username, password);
  const detail = await findDevice(row.username);
  return {
    username: row.username,
    plan: row.plan ?? "",
    expiresAt: row.expires_at ?? null,
    device: {
      id: detail.id,
      model: detail.model,
      manufacturer: detail.manufacturer,
      online: detail.online,
      lastInform: detail.lastInform,
    },
    bands: bandsOf(detail),
  };
}

export async function customerWifiUpdate(input: {
  username: string;
  password: string;
  /** Index WiFi yang diubah; kosong = semua band. */
  indexes: string[];
  ssid: string;
  wifiPassword: string;
}) {
  const row = await verifyCustomer(input.username, input.password);
  const detail = await findDevice(row.username);
  const all = bandsOf(detail);
  const pilih = input.indexes.length
    ? all.filter((b) => input.indexes.includes(b.index))
    : all;
  if (!pilih.length) throw new Error("Jaringan WiFi tidak ditemukan pada modem Anda.");

  const writes: { path: string; value: string; type?: string }[] = [];
  for (const b of pilih) {
    if (input.ssid) {
      // Band 5 GHz diberi akhiran -5G agar tidak bentrok dengan 2.4 GHz.
      const suffix = pilih.length > 1 && /5\s*g/i.test(b.band) ? "-5G" : "";
      writes.push({ path: b.ssidPath, value: `${input.ssid}${suffix}`, type: "xsd:string" });
    }
    if (input.wifiPassword && b.keyPath) {
      writes.push({ path: b.keyPath, value: input.wifiPassword, type: "xsd:string" });
    }
  }
  if (!writes.length) throw new Error("Tidak ada perubahan untuk disimpan.");
  const settings = await getSettings();
  await acsSetParams(detail.id, writes, settings["genieacs.nbiUrl"] || undefined);
  return { changed: pilih.map((b) => b.band) };
}
