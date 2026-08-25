import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/Shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  acsActionRun,
  acsDeviceGet,
  acsDevicesGet,
  acsObjectAdd,
  acsObjectDelete,
  acsParamsSet,
} from "@/lib/genieacs.functions";
import { useAcs, writeAcs } from "@/lib/genieacs-store";

export const Route = createFileRoute("/onu")({
  head: () => ({
    meta: [
      { title: "Kelola ONU TR-069 — BILLING RADIUS" },
      {
        name: "description",
        content:
          "Atur WAN PPPoE, VLAN, SSID dan password WiFi ONU pelanggan lewat GenieACS langsung dari panel Billing Radius.",
      },
      { property: "og:title", content: "Kelola ONU TR-069 — BILLING RADIUS" },
      {
        property: "og:description",
        content: "Konfigurasi WAN, VLAN, SSID, dan password WiFi ONU dari panel Billing Radius.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OnuPage,
});

type Write = { path: string; value: string; type?: string };

function OnuPage() {
  const { panel, ready } = useAcs();
  const qc = useQueryClient();
  const [nbi, setNbi] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const nbiUrl = panel.nbiUrl || undefined;

  const devices = useQuery({
    queryKey: ["acs-devices", nbiUrl ?? ""],
    queryFn: () => acsDevicesGet({ data: { nbiUrl } }),
    enabled: ready,
    refetchInterval: 60_000,
  });

  const list = (devices.data?.devices ?? []).filter((d) => {
    const t = `${d.serial} ${d.model} ${d.manufacturer} ${d.ppp} ${d.ip} ${d.id}`.toLowerCase();
    return t.includes(q.trim().toLowerCase());
  });

  const simpanNbi = () => {
    writeAcs({ ...panel, nbiUrl: nbi || panel.nbiUrl });
    toast.success("URL API GenieACS disimpan");
    setTimeout(() => qc.invalidateQueries({ queryKey: ["acs-devices"] }), 100);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kelola ONU (TR-069)"
        description="Atur WAN/PPPoE, VLAN, SSID & password WiFi, reboot ONU pelanggan lewat GenieACS."
      />

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="nbi">URL API GenieACS (NBI)</Label>
            <Input
              id="nbi"
              placeholder={panel.nbiUrl || "http://127.0.0.1:7557"}
              value={nbi}
              onChange={(e) => setNbi(e.target.value)}
            />
          </div>
          <Button onClick={simpanNbi} className="gap-2">
            <Save className="h-4 w-4" /> Simpan
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Kosongkan untuk memakai default <code>http://127.0.0.1:7557</code> (GenieACS di server
          yang sama). Data diambil langsung dari GenieACS, jadi tidak ada masalah mixed content.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Cari serial, model, atau user PPPoE…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button variant="outline" className="gap-2" onClick={() => devices.refetch()}>
          <RefreshCw className={`h-4 w-4 ${devices.isFetching ? "animate-spin" : ""}`} /> Muat ulang
        </Button>
      </div>

      {devices.data && !devices.data.ok ? (
        <div className="rounded-xl border border-dashed p-6 text-sm">
          <p className="font-medium">Gagal ambil data dari GenieACS</p>
          <p className="text-muted-foreground">{devices.data.error}</p>
        </div>
      ) : null}

      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Serial</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">User PPPoE</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {devices.isLoading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Belum ada ONU terdaftar di GenieACS.
                </td>
              </tr>
            ) : (
              list.map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{d.serial}</td>
                  <td className="px-3 py-2">{d.model || "-"}</td>
                  <td className="px-3 py-2">{d.ppp || "-"}</td>
                  <td className="px-3 py-2">{d.ip || "-"}</td>
                  <td className="px-3 py-2">
                    <Badge variant={d.online ? "default" : "secondary"}>
                      {d.online ? "Online" : "Offline"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpenId(d.id)}>
                      Kelola
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {openId ? (
        <DeviceDialog id={openId} nbiUrl={nbiUrl} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}

function DeviceDialog({
  id,
  nbiUrl,
  onClose,
}: {
  id: string;
  nbiUrl?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["acs-device", id, nbiUrl ?? ""],
    queryFn: () => acsDeviceGet({ data: { id, nbiUrl } }),
  });
  const device = detail.data?.device ?? null;

  const [draft, setDraft] = useState<Record<string, string>>({});
  const val = (path: string | null, fallback: string) =>
    path && path in draft ? draft[path]! : fallback;
  const set = (path: string, value: string) => setDraft((p) => ({ ...p, [path]: value }));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["acs-device", id] });
    qc.invalidateQueries({ queryKey: ["acs-devices"] });
  };

  const save = useMutation({
    mutationFn: async (writes: Write[]) => acsParamsSet({ data: { id, writes, nbiUrl } }),
    onSuccess: (r) => {
      if (!r.ok) return toast.error(r.error ?? "Gagal mengirim perintah");
      toast.success("Perintah dikirim ke ONU");
      setDraft({});
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const act = useMutation({
    mutationFn: async (action: "reboot" | "factoryReset" | "refresh") =>
      acsActionRun({ data: { id, action, nbiUrl } }),
    onSuccess: (r) => {
      if (!r.ok) return toast.error(r.error ?? "Gagal mengirim perintah");
      toast.success("Perintah dikirim");
      invalidate();
    },
  });

  const addWan = useMutation({
    mutationFn: async (objectName: string) => acsObjectAdd({ data: { id, objectName, nbiUrl } }),
    onSuccess: (r) => {
      if (!r.ok) return toast.error(r.error ?? "Gagal menambah WAN");
      toast.success("WAN baru ditambahkan, tunggu ONU inform lalu muat ulang");
      invalidate();
    },
  });

  const delObj = useMutation({
    mutationFn: async (objectName: string) => acsObjectDelete({ data: { id, objectName, nbiUrl } }),
    onSuccess: (r) => {
      if (!r.ok) return toast.error(r.error ?? "Gagal menghapus");
      toast.success("Perintah hapus dikirim");
      invalidate();
    },
  });

  const saveDraft = () => {
    const writes = Object.entries(draft).map(([path, value]) => ({ path, value }));
    if (!writes.length) return toast.info("Tidak ada perubahan");
    save.mutate(writes);
  };

  const wanBase = device?.wan[0]?.path.replace(/\.\d+$/, "") ?? "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Kelola ONU {device ? `· ${device.serial}` : ""}
          </DialogTitle>
        </DialogHeader>

        {detail.isLoading ? (
          <div className="py-10 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : !device ? (
          <p className="text-sm text-muted-foreground">
            {detail.data?.error ?? "Perangkat tidak ditemukan"}
          </p>
        ) : (
          <Tabs defaultValue="wifi">
            <TabsList>
              <TabsTrigger value="wifi">WiFi / SSID</TabsTrigger>
              <TabsTrigger value="wan">WAN / VLAN</TabsTrigger>
              <TabsTrigger value="info">Info & Aksi</TabsTrigger>
              <TabsTrigger value="lanjut">Parameter Lanjut</TabsTrigger>
            </TabsList>

            <TabsContent value="wifi" className="space-y-4 pt-4">
              {device.wifi.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Parameter WiFi belum terbaca. Klik <b>Refresh Parameter</b> di tab Info, tunggu
                  ONU inform, lalu buka lagi.
                </p>
              ) : (
                device.wifi.map((w) => (
                  <div key={w.ssidPath} className="rounded-lg border p-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Wifi className="h-4 w-4" /> SSID {w.index}
                      <Badge variant="secondary">{w.band}</Badge>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Nama SSID</Label>
                        <Input
                          value={val(w.ssidPath, w.ssid)}
                          onChange={(e) => set(w.ssidPath, e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Password WiFi</Label>
                        <Input
                          placeholder={w.keyPath ? "" : "tidak tersedia di ONU ini"}
                          disabled={!w.keyPath}
                          value={val(w.keyPath, w.key)}
                          onChange={(e) => w.keyPath && set(w.keyPath, e.target.value)}
                        />
                      </div>
                    </div>
                    {w.enablePath ? (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={
                            val(w.enablePath, w.enabled ? "true" : "false") === "true"
                          }
                          onCheckedChange={(c) => set(w.enablePath!, c ? "true" : "false")}
                        />
                        <span className="text-sm text-muted-foreground">Aktifkan SSID ini</span>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="wan" className="space-y-4 pt-4">
              {device.wan.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Parameter WAN belum terbaca. Jalankan <b>Refresh Parameter</b> dulu.
                </p>
              ) : (
                device.wan.map((w) => (
                  <div key={w.path} className="rounded-lg border p-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      WAN {w.index}
                      <Badge variant="secondary">{w.kind === "ppp" ? "PPPoE" : "IP/Bridge"}</Badge>
                      {w.connectionStatus ? (
                        <Badge variant="outline">{w.connectionStatus}</Badge>
                      ) : null}
                      {w.externalIp ? (
                        <span className="text-xs text-muted-foreground">{w.externalIp}</span>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto gap-1 text-destructive"
                        onClick={() => delObj.mutate(w.path)}
                      >
                        <Trash2 className="h-4 w-4" /> Hapus WAN
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>User PPPoE</Label>
                        <Input
                          disabled={!w.usernamePath}
                          placeholder={w.usernamePath ? "" : "bukan koneksi PPPoE"}
                          value={val(w.usernamePath, w.username)}
                          onChange={(e) => w.usernamePath && set(w.usernamePath, e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Password PPPoE</Label>
                        <Input
                          disabled={!w.passwordPath}
                          placeholder={w.passwordPath ? "isi untuk mengganti" : "tidak tersedia"}
                          value={val(w.passwordPath, "")}
                          onChange={(e) => w.passwordPath && set(w.passwordPath, e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>VLAN ID</Label>
                        <Input
                          disabled={!w.vlanPath}
                          placeholder={w.vlanPath ? "" : "parameter VLAN tidak terbaca"}
                          value={val(w.vlanPath, w.vlan)}
                          onChange={(e) => w.vlanPath && set(w.vlanPath, e.target.value)}
                        />
                        {w.vlanPath ? (
                          <p className="text-[11px] text-muted-foreground break-all">
                            {w.vlanPath}
                          </p>
                        ) : null}
                      </div>
                      {w.enablePath ? (
                        <div className="flex items-end gap-2">
                          <Switch
                            checked={val(w.enablePath, w.enabled ? "true" : "false") === "true"}
                            onCheckedChange={(c) => set(w.enablePath!, c ? "true" : "false")}
                          />
                          <span className="text-sm text-muted-foreground">Aktifkan WAN</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              )}

              {wanBase ? (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => addWan.mutate(wanBase)}
                  disabled={addWan.isPending}
                >
                  <Plus className="h-4 w-4" /> Tambah WAN baru
                </Button>
              ) : null}
            </TabsContent>

            <TabsContent value="info" className="space-y-4 pt-4">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <Info label="Serial" value={device.serial} />
                <Info label="Pabrikan" value={device.manufacturer} />
                <Info label="Model" value={device.model} />
                <Info label="Firmware" value={device.softwareVersion} />
                <Info
                  label="Inform terakhir"
                  value={device.lastInform ? new Date(device.lastInform).toLocaleString("id-ID") : "-"}
                />
                <Info label="IP WAN" value={device.ip} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-2" onClick={() => act.mutate("refresh")}>
                  <RefreshCw className="h-4 w-4" /> Refresh Parameter
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => act.mutate("reboot")}>
                  <RotateCcw className="h-4 w-4" /> Reboot ONU
                </Button>
                <Button
                  variant="destructive"
                  className="gap-2"
                  onClick={() => {
                    if (confirm("Factory reset ONU ini? Semua setting ONU akan hilang.")) {
                      act.mutate("factoryReset");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Factory Reset
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="lanjut" className="pt-4">
              <AdvancedParams params={device.params} draft={draft} set={set} />
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
          <Button onClick={saveDraft} disabled={save.isPending} className="gap-2">
            {save.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Simpan & kirim ke ONU
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-all">{value || "-"}</p>
    </div>
  );
}

function AdvancedParams({
  params,
  draft,
  set,
}: {
  params: Record<string, string>;
  draft: Record<string, string>;
  set: (path: string, value: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const rows = Object.entries(params)
    .filter(([k]) => (filter ? k.toLowerCase().includes(filter.toLowerCase()) : false))
    .slice(0, 60);

  return (
    <div className="space-y-3">
      <Input
        placeholder="Cari parameter, mis. SSID, VLAN, Username…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {!filter ? (
        <p className="text-sm text-muted-foreground">
          Ketik kata kunci untuk mencari parameter TR-069 apa pun dan mengubah nilainya.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada parameter cocok.</p>
      ) : (
        rows.map(([path, value]) => (
          <div key={path} className="space-y-1">
            <p className="break-all text-[11px] text-muted-foreground">{path}</p>
            <Input
              value={path in draft ? draft[path]! : value}
              onChange={(e) => set(path, e.target.value)}
            />
          </div>
        ))
      )}
    </div>
  );
}
