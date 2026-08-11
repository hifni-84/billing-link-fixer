import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PowerOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { NotConfigured, PageHeader } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { mt, useActive } from "@/lib/hotspot";
import { formatBytes } from "@/lib/mikrotik-types";
import { useCreds } from "@/lib/router-store";

export const Route = createFileRoute("/user-aktif")({
  head: () => ({
    meta: [
      { title: "User Aktif Hotspot — NAJWA_BILLING" },
      {
        name: "description",
        content:
          "Monitor sesi hotspot yang sedang online: IP, MAC, durasi, sisa waktu, dan pemakaian data.",
      },
      { property: "og:title", content: "User Aktif Hotspot — NAJWA_BILLING" },
      {
        property: "og:description",
        content: "Pantau dan putuskan sesi user hotspot yang sedang online.",
      },
    ],
  }),
  component: ActivePage,
});

function ActivePage() {
  const { creds, configured, ready } = useCreds();
  const active = useActive(creds, configured);
  const qc = useQueryClient();

  // Router bisa mengirim entri ganda saat data besar → hitung unik per .id.
  const rows = Array.from(
    new Map((active.data ?? []).map((s) => [s[".id"] || `${s.user}|${s.address}`, s])).values(),
  );
  const perServer = rows.reduce<Record<string, number>>((acc, s) => {
    const key = s.server?.trim() || "(tanpa server)";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      const res = await mt(creds, `/ip/hotspot/active/${id}`, "DELETE");
      if (!res.ok) throw new Error(res.error ?? "Gagal memutus sesi");
    },
    onSuccess: () => {
      toast.success("Sesi diputus");
      qc.invalidateQueries({ queryKey: ["active"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (ready && !configured) {
    return (
      <>
        <PageHeader title="User Aktif" description="Sesi hotspot yang sedang berjalan." />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="User Aktif"
        description={`Total user aktif: ${rows.length} di router ${creds.host || "-"} — diperbarui otomatis setiap 10 detik. Winbox menampilkan angka lebih kecil bila tab Active sedang difilter atau hanya satu hotspot server yang dilihat.`}
        action={
          <div className="flex items-center gap-3">
            <span className="rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm">
              Total Aktif: <strong className="mono-num">{rows.length}</strong>
            </span>
            <Button variant="outline" onClick={() => active.refetch()}>
              <RefreshCw className="size-4" /> Muat Ulang
            </Button>
          </div>
        }
      />

      {active.isError && (
        <div className="panel mb-6 border-destructive/40 p-4 text-sm text-destructive">
          {(active.error as Error).message}
        </div>
      )}

      {rows.length > 0 && (
        <div className="panel mb-6 p-4">
          <h2 className="mb-2 text-sm font-semibold">Rincian per Hotspot Server</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(perServer)
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => (
                <span
                  key={name}
                  className="rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs"
                >
                  {name}: <strong className="mono-num">{count}</strong>
                </span>
              ))}
          </div>
        </div>
      )}

      <div className="panel overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Server</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>MAC</TableHead>
              <TableHead>Uptime</TableHead>
              <TableHead>Sisa Waktu</TableHead>
              <TableHead>Download</TableHead>
              <TableHead>Upload</TableHead>
              <TableHead className="w-16 text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s[".id"]}>
                <TableCell className="font-medium">{s.user}</TableCell>
                <TableCell className="text-xs">{s.server ?? "-"}</TableCell>
                <TableCell className="mono-num">{s.address ?? "-"}</TableCell>
                <TableCell className="mono-num text-xs">{s["mac-address"] ?? "-"}</TableCell>
                <TableCell className="mono-num">{s.uptime ?? "-"}</TableCell>
                <TableCell className="mono-num">{s["session-time-left"] ?? "-"}</TableCell>
                <TableCell className="mono-num">{formatBytes(s["bytes-out"])}</TableCell>
                <TableCell className="mono-num">{formatBytes(s["bytes-in"])}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Putus sesi ${s.user}`}
                    onClick={() => disconnect.mutate(s[".id"])}
                  >
                    <PowerOff className="size-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!active.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  Tidak ada user yang sedang online.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
