/** Tipe bersama untuk pemantauan trafik aplikasi (aman dipakai di browser). */

export type TrafficAppKey =
  | "youtube"
  | "tiktok"
  | "facebook"
  | "instagram"
  | "whatsapp"
  | "telegram"
  | "game"
  | "meeting"
  | "browsing"
  | "other";

export type TrafficClient = {
  ip: string;
  /** Nama user PPPoE/Hotspot bila IP cocok dengan sesi RADIUS aktif. */
  username: string | null;
  bytes: number;
  bps: number;
  flows: number;
};

export type TrafficApp = {
  key: TrafficAppKey;
  label: string;
  /** Total byte (upload + download) dari flow yang sedang aktif. */
  bytes: number;
  /** Kecepatan saat ini dalam bit per detik. */
  bps: number;
  users: number;
  flows: number;
  clients: TrafficClient[];
};

export type TrafficSnapshot = {
  ok: boolean;
  error: string | null;
  /** Nama interface yang dipantau di ntopng, mis. enp2s0. */
  iface: string | null;
  url: string;
  totalBytes: number;
  totalBps: number;
  totalUsers: number;
  apps: TrafficApp[];
  updatedAt: string;
};

export const TRAFFIC_APPS: { key: TrafficAppKey; label: string }[] = [
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "telegram", label: "Telegram" },
  { key: "game", label: "Game" },
  { key: "meeting", label: "Zoom / Meeting" },
  { key: "browsing", label: "Browsing Web" },
  { key: "other", label: "Lainnya" },
];

export function formatBps(bps: number) {
  if (!bps || bps < 1) return "0 bps";
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  let v = bps;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
