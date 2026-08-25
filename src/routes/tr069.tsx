import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readAcs, useAcs, writeAcs } from "@/lib/genieacs-store";

export const Route = createFileRoute("/tr069")({
  head: () => ({
    meta: [
      { title: "TR-069 GenieACS — BILLING RADIUS" },
      {
        name: "description",
        content:
          "Buka panel GenieACS (TR-069) langsung dari Billing Radius untuk memantau dan mengatur ONU pelanggan.",
      },
      { property: "og:title", content: "TR-069 GenieACS — BILLING RADIUS" },
      {
        property: "og:description",
        content: "Akses GenieACS TR-069 untuk manajemen ONU dari dalam panel Billing Radius.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Tr069Page,
});

function Tr069Page() {
  const { panel, configured } = useAcs();
  const [url, setUrl] = useState("");
  const [cwmpUrl, setCwmpUrl] = useState("");
  const [frameKey, setFrameKey] = useState(0);
  const [pageHttps, setPageHttps] = useState(false);

  useEffect(() => setUrl(panel.url), [panel.url]);
  useEffect(() => setCwmpUrl(panel.cwmpUrl ?? ""), [panel.cwmpUrl]);
  useEffect(() => {
    setPageHttps(window.location.protocol === "https:");
  }, []);

  const mixedContent = pageHttps && /^http:\/\//i.test(panel.url);

  const simpan = () => {
    writeAcs({ url, cwmpUrl });
    toast.success("Pengaturan GenieACS disimpan");
    setFrameKey((k) => k + 1);
  };


  const buka = () => {
    const target = readAcs().url;
    if (!target) {
      toast.error("Isi URL GenieACS dulu");
      return;
    }
    window.open(target, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="TR-069 GenieACS"
        description="Panel GenieACS terpisah (repo alijayanet) untuk manajemen ONU pelanggan."
      />

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="acs-url">URL Web UI GenieACS</Label>
            <Input
              id="acs-url"
              placeholder="http://192.168.23.251:3001"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <Button onClick={simpan} className="gap-2">
            <Save className="h-4 w-4" /> Simpan
          </Button>
          <Button variant="outline" onClick={buka} className="gap-2">
            <ExternalLink className="h-4 w-4" /> Buka tab baru
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="acs-cwmp">URL ACS di ONT (CWMP)</Label>
          <Input
            id="acs-cwmp"
            placeholder="http://192.168.23.5:7547"
            value={cwmpUrl}
            onChange={(e) => setCwmpUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Isi sesuai IP:port yang sudah tersetting di ONT. Agar server menjawab di IP
            tersebut, jalankan sekali di server:{" "}
            <code>sudo bash deploy/set-acs-ip.sh {ipPort.ip} {ipPort.port}</code>
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Login default GenieACS: <b>admin / admin</b>. Pasang dengan{" "}
          <code>sudo bash deploy/install-genieacs.sh</code> (UI otomatis di port 3001, CWMP 7547).
        </p>
      </div>


      {configured && mixedContent ? (
        <div className="rounded-xl border border-dashed p-6 text-sm space-y-3">
          <p className="font-medium">Tampilan dalam panel diblokir browser (mixed content)</p>
          <p className="text-muted-foreground">
            Panel ini dibuka lewat <b>https</b>, sedangkan GenieACS di{" "}
            <code>{panel.url}</code> masih <b>http</b>. Browser selalu menolak menampilkan
            http di dalam halaman https, jadi harus dibuka di tab baru. Agar bisa tampil
            langsung di panel, akses GenieACS lewat domain https (misal{" "}
            <code>https://acs.domain-anda.com</code>) lalu isi URL itu di kolom di atas.
          </p>
          <Button onClick={buka} className="gap-2">
            <ExternalLink className="h-4 w-4" /> Buka GenieACS di tab baru
          </Button>
        </div>
      ) : configured ? (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="truncate text-sm text-muted-foreground">{panel.url}</span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              onClick={() => setFrameKey((k) => k + 1)}
            >
              <RefreshCw className="h-4 w-4" /> Muat ulang
            </Button>
          </div>
          <iframe
            key={frameKey}
            src={panel.url}
            title="GenieACS"
            className="h-[70vh] w-full border-0 bg-background"
          />
          <div className="border-t px-3 py-2 text-xs text-muted-foreground">
            Jika halaman kosong, GenieACS memblokir tampilan dalam frame — pakai tombol
            &quot;Buka tab baru&quot;.
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Belum ada URL GenieACS. Isi kolom di atas, misalnya{" "}
          <code>http://IP-SERVER:3001</code>.
        </div>
      )}
    </div>
  );
}
