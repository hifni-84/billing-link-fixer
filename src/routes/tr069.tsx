import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ExternalLink, Plus, Power, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  acsActionRun,
  acsDeviceGet,
  acsDevicesGet,
  acsParamsSet,
  acsWanAdd,
  acsWanDelete,
} from "@/lib/genieacs.functions";

const HOST = "192.168.23.5";

export const Route = createFileRoute("/tr069")({
  head: () => ({
    meta: [
      { title: "TR-069 Modem — BILLING RADIUS" },
      { name: "description", content: "Daftar modem pelanggan, ganti WiFi, reboot, dan tambah WAN PPPoE/Bridge lewat GenieACS." },
      { property: "og:title", content: "TR-069 Modem — BILLING RADIUS" },
      { property: "og:description", content: "Kelola modem pelanggan lewat GenieACS 192.168.23.5." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Tr069Page,
});

function fmtTime(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  const rel = m < 1 ? "baru saja" : m < 60 ? `${m} mnt lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`;
  return `${d.toLocaleString("id-ID")} (${rel})`;
}

function Tr069Page() {
  const list = useServerFn(acsDevicesGet);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const devices = useQuery({ queryKey: ["tr069-devices"], queryFn: () => list() });

  const rows = useMemo(() => {
    const all = devices.data?.devices ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((d) =>
      [d.serial, d.id, d.model, d.manufacturer, d.ip, ...d.pppNames, ...d.ssids]
        .join(" ")
        .toLowerCase()
        .includes(s),
    );
  }, [devices.data, q]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="TR-069 Modem"
        description={`Server GenieACS: http://${HOST} · Alamat ACS di modem: http://${HOST}:7547`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={`http://${HOST}:3001`} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> Buka GenieACS
              </a>
            </Button>
            <Button onClick={() => devices.refetch()} disabled={devices.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${devices.isFetching ? "animate-spin" : ""}`} /> Muat ulang
            </Button>
          </div>
        }
      />

      {devices.data && !devices.data.ok && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Tidak bisa terhubung ke GenieACS di http://{HOST}:7557 — {devices.data.error}
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Cari nomor seri, user PPPoE, SSID, IP…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="p-3">Status</th>
              <th className="p-3">Nomor Seri</th>
              <th className="p-3">Model</th>
              <th className="p-3">User PPPoE</th>
              <th className="p-3">SSID</th>
              <th className="p-3">IP</th>
              <th className="p-3">Lapor terakhir</th>
            </tr>
          </thead>
          <tbody>
            {devices.isLoading && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Memuat modem…</td></tr>
            )}
            {!devices.isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Belum ada modem yang terdaftar.</td></tr>
            )}
            {rows.map((d) => (
              <tr
                key={d.id}
                onClick={() => setSelected(d.id)}
                className={`cursor-pointer border-t hover:bg-muted/40 ${selected === d.id ? "bg-muted/60" : ""}`}
              >
                <td className="p-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${d.online ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${d.online ? "bg-primary" : "bg-muted-foreground"}`} />
                    {d.online ? "Online" : "Terlambat lapor"}
                  </span>
                </td>
                <td className="p-3 font-mono">{d.serial}</td>
                <td className="p-3">{[d.manufacturer, d.model].filter(Boolean).join(" ")}</td>
                <td className="p-3">{d.ppp || "-"}</td>
                <td className="p-3">{d.ssids.join(", ") || "-"}</td>
                <td className="p-3 font-mono">{d.ip || "-"}</td>
                <td className="p-3 text-xs">{fmtTime(d.lastInform)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && <DevicePanel id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function DevicePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const get = useServerFn(acsDeviceGet);
  const setParams = useServerFn(acsParamsSet);
  const action = useServerFn(acsActionRun);
  const addWan = useServerFn(acsWanAdd);
  const delWan = useServerFn(acsWanDelete);
  const detail = useQuery({ queryKey: ["tr069-device", id], queryFn: () => get({ data: { id } }) });
  const [busy, setBusy] = useState<string | null>(null);
  const [wifiEdit, setWifiEdit] = useState<Record<string, { ssid?: string; key?: string }>>({});
  const [wan, setWan] = useState({ mode: "pppoe" as "pppoe" | "bridge", username: "", password: "", vlan: "" });

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["tr069-device", id] });
    qc.invalidateQueries({ queryKey: ["tr069-devices"] });
  };

  async function run(label: string, fn: () => Promise<{ ok: boolean; error: string | null }>, okMsg: string) {
    setBusy(label);
    try {
      const r = await fn();
      if (r.ok) {
        toast.success(okMsg);
        reload();
      } else toast.error(r.error ?? "Gagal");
    } finally {
      setBusy(null);
    }
  }

  const d = detail.data?.device;

  return (
    <div className="space-y-5 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{d ? `${d.manufacturer} ${d.model}` : "Memuat modem…"}</h2>
          {d && <p className="font-mono text-xs text-muted-foreground">{d.serial} · {d.ip || "tanpa IP"} · lapor {fmtTime(d.lastInform)}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => run("refresh", () => action({ data: { id, action: "refresh" } }), "Data modem diperbarui")}>
            <RefreshCw className="mr-2 h-4 w-4" /> Ambil data
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!!busy}
            onClick={() => confirm("Reboot modem ini? Internet pelanggan putus sebentar.") && run("reboot", () => action({ data: { id, action: "reboot" } }), "Perintah reboot dikirim")}
          >
            <Power className="mr-2 h-4 w-4" /> Reboot
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      </div>

      {detail.data && !detail.data.ok && <p className="text-sm text-destructive">{detail.data.error}</p>}

      {d && (
        <>
          <section className="space-y-3">
            <h3 className="font-medium">WiFi</h3>
            {d.wifi.length === 0 && <p className="text-sm text-muted-foreground">Data WiFi belum terbaca. Tekan "Ambil data".</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {d.wifi.map((w) => {
                const e = wifiEdit[w.index] ?? {};
                return (
                  <div key={w.ssidPath} className="space-y-2 rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">WLAN {w.index} · {w.band} · {w.clients.length} perangkat</p>
                    <Label>Nama WiFi</Label>
                    <Input value={e.ssid ?? w.ssid} onChange={(ev) => setWifiEdit({ ...wifiEdit, [w.index]: { ...e, ssid: ev.target.value } })} />
                    {w.keyPath && (
                      <>
                        <Label>Sandi WiFi (min. 8 karakter)</Label>
                        <Input value={e.key ?? w.key} onChange={(ev) => setWifiEdit({ ...wifiEdit, [w.index]: { ...e, key: ev.target.value } })} />
                      </>
                    )}
                    <Button
                      size="sm"
                      disabled={!!busy}
                      onClick={() => {
                        const writes: { path: string; value: string; type: string }[] = [];
                        if (e.ssid !== undefined && e.ssid.trim() && e.ssid !== w.ssid) writes.push({ path: w.ssidPath, value: e.ssid.trim(), type: "xsd:string" });
                        if (w.keyPath && e.key !== undefined && e.key !== w.key) {
                          if (e.key.length < 8) { toast.error("Sandi minimal 8 karakter"); return; }
                          writes.push({ path: w.keyPath, value: e.key, type: "xsd:string" });
                        }
                        if (!writes.length) { toast.info("Tidak ada perubahan"); return; }
                        run(`wifi-${w.index}`, () => setParams({ data: { id, writes } }), "WiFi disimpan ke modem");
                      }}
                    >
                      <Save className="mr-2 h-4 w-4" /> Simpan
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="font-medium">WAN</h3>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr><th className="p-2">Jalur</th><th className="p-2">Jenis</th><th className="p-2">User</th><th className="p-2">VLAN</th><th className="p-2">Status</th><th className="p-2">IP</th><th className="p-2" /></tr>
                </thead>
                <tbody>
                  {d.wan.length === 0 && <tr><td colSpan={7} className="p-3 text-center text-muted-foreground">Belum ada WAN terbaca.</td></tr>}
                  {d.wan.map((w) => (
                    <tr key={w.path} className="border-t">
                      <td className="p-2 font-mono text-xs">{w.path.replace("InternetGatewayDevice.WANDevice.1.", "")}</td>
                      <td className="p-2">{w.kind === "ppp" ? "PPPoE" : "IP / Bridge"}</td>
                      <td className="p-2">{w.username || "-"}</td>
                      <td className="p-2">{w.vlan || "-"}</td>
                      <td className="p-2">{w.connectionStatus || "-"}</td>
                      <td className="p-2 font-mono">{w.externalIp || "-"}</td>
                      <td className="p-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => confirm(`Hapus WAN ${w.path}?`) && run("delwan", () => delWan({ data: { id, path: w.path } }), "WAN dihapus")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 rounded-md border p-3 md:grid-cols-5">
              <div className="space-y-1">
                <Label>Jenis WAN</Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={wan.mode}
                  onChange={(e) => setWan({ ...wan, mode: e.target.value as "pppoe" | "bridge" })}
                >
                  <option value="pppoe">PPPoE (Route)</option>
                  <option value="bridge">Bridge</option>
                </select>
              </div>
              {wan.mode === "pppoe" && (
                <>
                  <div className="space-y-1"><Label>User PPPoE</Label><Input value={wan.username} onChange={(e) => setWan({ ...wan, username: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Sandi PPPoE</Label><Input value={wan.password} onChange={(e) => setWan({ ...wan, password: e.target.value })} /></div>
                </>
              )}
              <div className="space-y-1"><Label>VLAN</Label><Input inputMode="numeric" placeholder="mis. 100" value={wan.vlan} onChange={(e) => setWan({ ...wan, vlan: e.target.value.replace(/\D/g, "") })} /></div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy("addwan");
                    try {
                      const r = await addWan({ data: { id, ...wan } });
                      if (!r.ok) { toast.error(r.error ?? "Gagal"); return; }
                      toast.success(r.vlanSet ? "WAN baru ditambahkan" : "WAN ditambahkan, tetapi VLAN tidak dikenali modem — atur VLAN di modem");
                      setWan({ mode: wan.mode, username: "", password: "", vlan: "" });
                      reload();
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" /> {busy === "addwan" ? "Menambah…" : "Tambah WAN"}
                </Button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
