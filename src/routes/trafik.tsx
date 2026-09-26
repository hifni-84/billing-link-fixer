import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Facebook,
  Gamepad2,
  Globe,
  Instagram,
  MessageCircle,
  Music2,
  Network,
  RefreshCw,
  Send,
  Users,
  Video,
  Youtube,
} from "lucide-react";

import { PageHeader } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes } from "@/lib/mikrotik-types";
import { trafficGet } from "@/lib/traffic.functions";
import { formatBps, type TrafficAppKey } from "@/lib/traffic-types";

export const Route = createFileRoute("/trafik")({
  head: () => ({
    meta: [
      { title: "Trafik Aplikasi — BILLING RADIUS" },
      {
        name: "description",
        content:
          "Pantau pemakaian YouTube, TikTok, Facebook, Instagram, WhatsApp, Telegram, Game, dan Zoom per pelanggan.",
      },
      { property: "og:title", content: "Trafik Aplikasi — BILLING RADIUS" },
      {
        property: "og:description",
        content: "Total pengguna dan bandwidth per aplikasi secara langsung.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrafikPage,
});

const ICONS: Record<TrafficAppKey, typeof Youtube> = {
  youtube: Youtube,
  tiktok: Music2,
  facebook: Facebook,
  instagram: Instagram,
  whatsapp: MessageCircle,
  telegram: Send,
  game: Gamepad2,
  meeting: Video,
  browsing: Globe,
  other: Network,
};

function TrafikPage() {
  const [pilih, setPilih] = useState<TrafficAppKey>("youtube");

  const q = useQuery({
    queryKey: ["trafik"],
    queryFn: () => trafficGet(),
    refetchInterval: 10_000,
  });

  const data = q.data;
  const apps = data?.apps ?? [];
  const aktif = apps.find((a) => a.key === pilih);

  return (
    <>
      <PageHeader
        title="Trafik Aplikasi"
        description="Pemakaian YouTube, TikTok, Facebook, Instagram, WhatsApp, Telegram, Game, dan Zoom secara langsung."
        action={
          <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} /> Muat Ulang
          </Button>
        }
      />

      {data?.error && (
        <div className="panel border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {data.error}
        </div>
      )}

      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <span className="flex items-center gap-2">
          <Users className="size-4 text-primary" />
          <span className="font-semibold">{data?.totalUsers ?? 0}</span>
          <span className="text-muted-foreground">pengguna aktif</span>
        </span>
        <span>
          <span className="font-semibold">{formatBps(data?.totalBps ?? 0)}</span>{" "}
          <span className="text-muted-foreground">total bandwidth</span>
        </span>
        <span>
          <span className="font-semibold">{formatBytes(data?.totalBytes ?? 0)}</span>{" "}
          <span className="text-muted-foreground">total data sesi berjalan</span>
        </span>
        {data?.iface && (
          <span className="text-muted-foreground">Sumber data: {data.iface}</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {apps.map((app) => {
          const Icon = ICONS[app.key];
          const active = app.key === pilih;
          return (
            <button
              key={app.key}
              type="button"
              onClick={() => setPilih(app.key)}
              className={`panel flex flex-col gap-3 p-4 text-left transition-colors ${
                active ? "border-primary/50 bg-primary/5" : "hover:bg-accent/40"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-md border border-border bg-accent/40 text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="text-sm font-semibold">{app.label}</span>
              </span>
              <span className="text-2xl font-semibold tracking-tight">
                {formatBps(app.bps)}
              </span>
              <span className="text-xs text-muted-foreground">
                {app.users} pengguna · {formatBytes(app.bytes)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="panel overflow-x-auto">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-semibold">
            Pengguna {aktif?.label ?? ""} ({aktif?.clients.length ?? 0})
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pengguna</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Bandwidth</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Koneksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(aktif?.clients ?? []).map((c) => (
              <TableRow key={c.ip}>
                <TableCell className="font-medium">{c.username ?? "—"}</TableCell>
                <TableCell>{c.ip}</TableCell>
                <TableCell>{formatBps(c.bps)}</TableCell>
                <TableCell>{formatBytes(c.bytes)}</TableCell>
                <TableCell>{c.flows}</TableCell>
              </TableRow>
            ))}
            {!aktif?.clients.length && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {q.isLoading ? "Memuat data…" : "Belum ada pengguna aktif pada aplikasi ini."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
