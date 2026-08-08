import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, Plus, RefreshCw, Stethoscope, Trash2, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { l2tpAdd, l2tpInfo, l2tpPeers, l2tpRemove, l2tpScript, l2tpTest } from "@/lib/l2tp.functions";
import { useCreds } from "@/lib/router-store";
import { wgSetEndpoint } from "@/lib/wireguard.functions";

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mono-num truncate text-sm">{value}</p>
    </div>
  );
}

/** Alternatif WireGuard: L2TP/IPsec, didukung MikroTik RouterOS v6. */
export function L2tpManager() {
  const qc = useQueryClient();
  const { creds } = useCreds();
  const info = useQuery({ queryKey: ["l2tp", "info"], queryFn: () => l2tpInfo() });
  const peers = useQuery({
    queryKey: ["l2tp", "peers"],
    queryFn: () => l2tpPeers(),
    refetchInterval: 20000,
  });

  const [nama, setNama] = useState("");
  const [secret, setSecret] = useState("rahasia123");
  const [endpointInput, setEndpointInput] = useState("");
  const [script, setScript] = useState<{ name: string; peerIp: string; text: string } | null>(null);
  const [diag, setDiag] = useState<string[] | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["l2tp"] });

  const simpanEndpoint = useMutation({
    mutationFn: () => wgSetEndpoint({ data: { endpoint: endpointInput } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(("error" in res && res.error) || "Gagal menyimpan IP publik");
        return;
      }
      toast.success(
        endpointInput.trim()
          ? `IP publik disetel ke ${endpointInput.trim()} — ambil ulang konfigurasi router`
          : "IP publik kembali otomatis (deteksi server)",
      );
      setEndpointInput("");
      qc.invalidateQueries({ queryKey: ["l2tp"] });
      qc.invalidateQueries({ queryKey: ["wg"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tambah = useMutation({
    mutationFn: () => l2tpAdd({ data: { name: nama, secret } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Gagal menambah router");
        return;
      }
      setScript({ name: res.name, peerIp: res.peerIp, text: res.script });
      setNama("");
      toast.success(
        res.applied
          ? `Router ${res.name} ditambahkan (${res.peerIp})`
          : `Router ${res.name} tersimpan (${res.peerIp}) — user VPN belum tertulis: ${res.applyError ?? ""}`,
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lihatScript = useMutation({
    mutationFn: (id: number) => l2tpScript({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Gagal mengambil konfigurasi");
        return;
      }
      setScript({ name: res.name, peerIp: res.peerIp, text: res.script });
    },
  });

  const hapus = useMutation({
    mutationFn: (id: number) => l2tpRemove({ data: { id } }),
    onSuccess: () => {
      setScript(null);
      toast.success("Router dihapus dari VPN L2TP");
      invalidate();
    },
  });

  const tes = useMutation({
    mutationFn: (id: number) =>
      l2tpTest({
        data: {
          id,
          creds: {
            username: creds.username,
            password: creds.password,
            ...(creds.port !== undefined ? { port: creds.port } : {}),
            ...(creds.useHttps !== undefined ? { useHttps: creds.useHttps } : {}),
          },
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Gagal menguji");
        return;
      }
      setDiag([
        `Router: ${res.name} (${res.peerIp})`,
        `User VPN terdaftar di server: ${res.inChap ? "ya" : "tidak"}`,
        `Tunnel: ${res.online ? "tersambung" : "belum tersambung"}`,
        `API router: ${res.api ? "terhubung" : `gagal — ${res.apiError ?? "-"}`}`,
        ...res.saran.map((s) => `• ${s}`),
      ]);
      if (res.api && res.online) toast.success("Router v6 terhubung penuh");
      else toast.warning("Belum terhubung — lihat hasil diagnosa");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salin = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success("Konfigurasi disalin");
  };

  const d = info.data;
  const list = peers.data?.peers ?? [];

  return (
    <div>
      <div className="panel mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Status Server L2TP/IPsec</h2>
          <Button variant="outline" size="sm" onClick={invalidate}>
            <RefreshCw className="mr-2 size-4" /> Muat Ulang
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Cocok untuk MikroTik RouterOS v6 yang belum mendukung WireGuard. Router menyambung sebagai
          L2TP client dengan enkripsi IPsec.
        </p>
        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Jaringan tunnel" value={d?.network ?? "-"} />
          <Info label="IP server (RADIUS)" value={d?.serverIp ?? "-"} />
          <Info label="Server L2TP" value={d?.endpoint || "-"} />
          <Info label="IPsec PSK" value={d?.psk ?? "-"} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              d?.ipsecUp && d?.l2tpUp
                ? "bg-primary/15 text-primary"
                : "bg-destructive/15 text-destructive"
            }`}
          >
            {d?.ipsecUp && d?.l2tpUp ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
            {d?.ipsecUp && d?.l2tpUp ? "Server VPN aktif" : "Server VPN tidak aktif"}
          </span>
          {d?.error && <span className="text-[11px] text-destructive">{d.error}</span>}
        </div>
        {!d?.ready && (
          <p className="mt-3 rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            Server L2TP belum disiapkan. Cukup sekali saja di server jalankan:{" "}
            <code className="mono-num">sudo bash deploy/install-l2tp.sh</code> lalu{" "}
            <code className="mono-num">sudo bash deploy/allow-l2tp-sudo.sh</code>. Pastikan port UDP
            500, 4500, dan 1701 terbuka.
          </p>
        )}
      </div>

      <div className="panel mb-6 p-5">
        <h2 className="mb-1 text-sm font-semibold">IP Publik / DNS Server VPN</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Deteksi otomatis bisa salah bila server punya beberapa IP. Isi IP publik atau nama domain
          yang benar, lalu <code className="mono-num">connect-to</code> pada konfigurasi router
          (WireGuard maupun L2TP) ikut berubah. Kosongkan lalu simpan untuk kembali otomatis.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">IP publik atau domain</Label>
            <Input
              value={endpointInput}
              onChange={(e) => setEndpointInput(e.target.value)}
              placeholder={d?.endpoint || "38.156.95.73"}
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full"
              disabled={simpanEndpoint.isPending}
              onClick={() => simpanEndpoint.mutate()}
            >
              Simpan IP Publik
            </Button>
          </div>
        </div>
      </div>

      <div className="panel mb-6 p-5">
        <h2 className="mb-1 text-sm font-semibold">Tambah Router (RouterOS v6)</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          User, password, dan IP tunnel dibuat otomatis; router langsung didaftarkan sebagai NAS
          RADIUS.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nama router</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="router-v6" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Secret RADIUS</Label>
            <Input value={secret} onChange={(e) => setSecret(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={!nama.trim() || tambah.isPending}
              onClick={() => tambah.mutate()}
            >
              <Plus className="mr-2 size-4" /> Tambah & Buat Konfigurasi
            </Button>
          </div>
        </div>
      </div>

      {script && (
        <div className="panel mb-6 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Konfigurasi MikroTik — {script.name} ({script.peerIp})
            </h2>
            <Button size="sm" variant="outline" onClick={() => salin(script.text)}>
              <Copy className="mr-2 size-4" /> Salin
            </Button>
          </div>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed">
            {script.text}
          </pre>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Tempel di terminal Winbox/SSH router. Di billing gunakan Host API{" "}
            <code className="mono-num">{script.peerIp}</code>.
          </p>
        </div>
      )}

      <div className="panel overflow-hidden">
        {diag && (
          <div className="border-b border-border px-4 py-3">
            <p className="mb-1 text-xs font-semibold">Hasil Diagnosa</p>
            <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
              {diag.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>IP Tunnel</TableHead>
                <TableHead>User VPN</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                    {peers.data?.error ?? "Belum ada router L2TP"}
                  </TableCell>
                </TableRow>
              )}
              {list.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="mono-num">{p.peerIp}</TableCell>
                  <TableCell className="mono-num text-xs">{p.username}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.online ? "tersambung" : "belum tersambung"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-2"
                      onClick={() => lihatScript.mutate(p.id)}
                    >
                      <Copy className="mr-1 size-3.5" /> Config
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-2"
                      disabled={tes.isPending}
                      onClick={() => tes.mutate(p.id)}
                    >
                      <Stethoscope className="mr-1 size-3.5" /> Tes
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => hapus.mutate(p.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
