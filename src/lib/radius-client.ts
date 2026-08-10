import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { readRouters } from "./routers-store";

import {
  radiusMaintenance,
  radiusNasList,
  radiusNasStatus,
  radiusPing,
  radiusPlans,
  radiusReport,
  radiusSessions,
  radiusUsers,
} from "./radius.functions";
import { mt } from "./hotspot";
import { readCreds } from "./router-store";
import type { MtCreds } from "./mikrotik-types";

export function useRadiusPing() {
  return useQuery({ queryKey: ["radius", "ping"], queryFn: () => radiusPing() });
}

export function useRadiusPlans() {
  return useQuery({ queryKey: ["radius", "plans"], queryFn: () => radiusPlans() });
}

export function useRadiusUsers() {
  return useQuery({
    queryKey: ["radius", "users"],
    queryFn: () => radiusUsers(),
    refetchInterval: 15000,
  });
}

export function useRadiusSessions() {
  return useQuery({
    queryKey: ["radius", "sessions"],
    queryFn: () => radiusSessions(),
    refetchInterval: 10000,
  });
}

export function useRadiusReport() {
  return useQuery({
    queryKey: ["radius", "report"],
    queryFn: () => radiusReport(),
    refetchInterval: 15000,
  });
}

export function useRadiusInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["radius"] });
}

export function useRadiusMutation<TVars>(fn: (v: TVars) => Promise<unknown>) {
  const invalidate = useRadiusInvalidate();
  return useMutation({ mutationFn: fn, onSuccess: invalidate });
}

/**
 * Bersihkan voucher expired di SATU router: putus sesi, hapus cookie,
 * lalu hapus user hotspot / secret PPPoE-nya.
 */
async function bersihkanRouter(creds: MtCreds, names: Set<string>) {
  const cocok = (v?: string) => !!v && names.has(v.trim().toLowerCase());

  const ambil = async (path: string) => {
    try {
      const res = await mt(creds, path);
      return (Array.isArray(res.data) ? res.data : []) as Record<string, string>[];
    } catch {
      return [] as Record<string, string>[];
    }
  };

  const hapus = async (path: string, rows: Record<string, string>[], key: string) => {
    for (const r of rows) {
      if (cocok(r[key]) && r[".id"]) {
        await mt(creds, `${path}/${r[".id"]}`, "DELETE").catch(() => {});
      }
    }
  };

  // 1) putus sesi aktif supaya "session time left" berhenti
  const [aktif, pppAktif, cookie] = await Promise.all([
    ambil("/ip/hotspot/active"),
    ambil("/ppp/active"),
    ambil("/ip/hotspot/cookie"),
  ]);
  await hapus("/ip/hotspot/active", aktif, "user");
  await hapus("/ppp/active", pppAktif, "name");
  // 2) hapus cookie hotspot agar tidak auto-login kembali
  await hapus("/ip/hotspot/cookie", cookie, "user");

  // 3) hapus user-nya; data di billing tetap tersimpan (status expired)
  const [hs, ppp] = await Promise.all([ambil("/ip/hotspot/user"), ambil("/ppp/secret")]);
  await hapus("/ip/hotspot/user", hs, "name");
  await hapus("/ppp/secret", ppp, "name");
}

/** Pemeriksaan expired tiap 1 menit + putus sesi user expired di MikroTik. */
export function useRadiusMaintenance(enabled: boolean, hapusExpired = true) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let stop = false;

    const tick = async () => {
      try {
        const res = await radiusMaintenance({ data: { hapusExpired } });
        if (stop) return;
        // Semua user expired (online maupun tidak) harus diputus & dihapus
        // di SEMUA router yang terdaftar, bukan hanya router utama.
        const set = new Set<string>(
          [...(res.expiredOnline ?? []), ...(res.expiredNames ?? [])]
            .filter(Boolean)
            .map((n) => n.trim().toLowerCase()),
        );
        if (set.size) {
          const daftar: MtCreds[] = [readCreds(), ...readRouters()].filter((r) => !!r.host);
          const unik = new Map<string, MtCreds>();
          for (const r of daftar) unik.set(`${r.host}:${r.port ?? ""}`, r);
          for (const r of unik.values()) {
            if (stop) return;
            await bersihkanRouter(r, set).catch(() => {});
          }
        }
        if (res.stamped || res.expired) qc.invalidateQueries({ queryKey: ["radius"] });
      } catch {
        /* database belum siap, dicoba lagi */
      }
    };

    tick();
    const id = window.setInterval(tick, 60000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [enabled, hapusExpired, qc]);
}

export function useRadiusNas() {
  return useQuery({ queryKey: ["radius", "nas"], queryFn: () => radiusNasList() });
}

/** Status terhubung/tidak: RADIUS (radacct) + REST API router. */
export function useRadiusNasStatus() {
  return useQuery({
    queryKey: ["radius", "nas-status"],
    queryFn: () => {
      const c = readCreds();
      const extra = readRouters().map((r) => ({
        host: r.host,
        username: r.username,
        password: r.password,
        ...(r.port !== undefined ? { port: r.port } : {}),
        ...(r.useHttps !== undefined ? { useHttps: r.useHttps } : {}),
      }));
      return radiusNasStatus({
        data: {
          creds: {
            username: c.username,
            password: c.password,
            ...(c.port !== undefined ? { port: c.port } : {}),
            ...(c.useHttps !== undefined ? { useHttps: c.useHttps } : {}),
          },
          routers: [
            {
              host: c.host,
              username: c.username,
              password: c.password,
              ...(c.port !== undefined ? { port: c.port } : {}),
              ...(c.useHttps !== undefined ? { useHttps: c.useHttps } : {}),
            },
            ...extra,
          ],
        },
      });
    },
    refetchInterval: 20000,
  });
}
