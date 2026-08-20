/**
 * Kelola IP publik / nama domain langsung dari panel:
 * simpan daftar domain, terapkan ke Nginx, dan pasang SSL otomatis.
 */
import { useEffect, useState } from "react";
import { Globe2, Loader2, Lock, LockOpen, Plus, ShieldCheck, Trash2, Wand2, Server } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { domainApplySave, domainStatusGet, mikhmonApplySave, mikhmonStatusGet } from "@/lib/domain.functions";

export function DomainManager() {
  const [domains, setDomains] = useState<string[]>([""]);
  const [email, setEmail] = useState("");
  const [port, setPort] = useState("3000");
  const [https, setHttps] = useState(true);
  const [ready, setReady] = useState(true);
  const [setupCmd, setSetupCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [certs, setCerts] = useState<{ domain: string; installed: boolean }[]>([]);

  useEffect(() => {
    void domainStatusGet()
      .then((r) => {
        if (!r.ok || !r.status) return;
        const s = r.status;
        setDomains(s.options.domains.length ? s.options.domains : [""]);
        setEmail(s.options.email);
        setPort(s.options.port || "3000");
        setHttps(s.options.https);
        setReady(s.ready);
        setSetupCmd(s.setupCommand);
        setPublicIp(s.publicIp);
        setSuggested(s.suggestedDomain);
        setCerts(s.certs);
      })
      .catch(() => undefined);
  }, []);

  const setAt = (i: number, v: string) =>
    setDomains((cur) => cur.map((d, idx) => (idx === i ? v : d)));

  const apply = async () => {
    const list = domains.map((d) => d.trim()).filter(Boolean);
    if (!list.length) {
      toast.error("Isi minimal satu IP publik atau nama domain");
      return;
    }
    setBusy(true);
    setLog("");
    try {
      const res = await domainApplySave({
        data: { options: { domains: list, email, port, https } },
      });
      setLog(res.log || res.error || "");
      if (res.error) toast.error(res.error);
      else if (res.ok) toast.success("Domain diterapkan ke server");
      else toast.error("Domain tersimpan, tapi penerapan di server gagal");
      const st = await domainStatusGet();
      if (st.ok && st.status) {
        setReady(st.status.ready);
        setCerts(st.status.certs);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const useSuggested = () => {
    if (!suggested) return;
    setDomains((cur) => [suggested, ...cur.filter((d) => d.trim() && d.trim() !== suggested)]);
    setHttps(true);
    toast.success(`Domain gratis ${suggested} dipakai sebagai domain utama`);
  };

  const certOf = (d: string) => certs.find((c) => c.domain === d.trim().toLowerCase());

  return (
    <div className="panel p-6 lg:col-span-2">
      <div className="mb-1 flex items-center gap-2">
        <Globe2 className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Domain &amp; SSL Otomatis</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Tambahkan IP publik atau nama domain di sini, lalu tekan Terapkan. Panel akan menulis
        konfigurasi Nginx dan memasang sertifikat HTTPS sendiri — tidak perlu mengetik perintah di
        server lagi. Domain pertama dipakai untuk link tagihan WhatsApp.
      </p>

      {!ready && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium">Izin server belum aktif</p>
          <p className="mt-1 text-muted-foreground">
            Jalankan perintah ini <span className="font-medium">satu kali saja</span> di server:
          </p>
          <code className="mono-num mt-2 block break-all rounded bg-background/70 p-2">
            {setupCmd || "sudo bash /opt/mikrotik-billing/deploy/allow-domain-sudo.sh"}
          </code>
        </div>
      )}

      <div className="mb-4 rounded-md border border-border bg-secondary/40 p-3 text-xs">
        <p>
          IP publik server:{" "}
          <span className="mono-num font-medium">{publicIp ?? "belum terdeteksi"}</span>
        </p>
        {suggested && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">
              Belum punya domain? Pakai domain gratis instan{" "}
              <span className="mono-num font-medium">{suggested}</span> — langsung bisa HTTPS.
            </span>
            <Button size="sm" variant="outline" onClick={useSuggested}>
              <Wand2 className="size-3.5" /> Pakai domain gratis
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-3">
        {domains.map((d, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="grid flex-1 gap-2">
              <Label htmlFor={`dom-${i}`}>
                {i === 0 ? "Domain utama / IP publik" : `Domain tambahan ${i}`}
              </Label>
              <Input
                id={`dom-${i}`}
                placeholder={i === 0 ? "mybillingg.site" : "www.mybillingg.site"}
                value={d}
                onChange={(e) => setAt(i, e.target.value)}
              />
              {d.trim() && certOf(d) && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  {certOf(d)?.installed ? (
                    <>
                      <Lock className="size-3 text-emerald-500" /> HTTPS aktif
                    </>
                  ) : (
                    <>
                      <LockOpen className="size-3 text-amber-500" /> Belum ada sertifikat
                    </>
                  )}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Hapus domain"
              disabled={domains.length === 1}
              onClick={() => setDomains((cur) => cur.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button variant="outline" className="w-fit" onClick={() => setDomains((c) => [...c, ""])}>
          <Plus className="size-4" /> Tambah domain
        </Button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="dom-port">Port aplikasi di server</Label>
          <Input
            id="dom-port"
            placeholder="3000"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="dom-email">Email untuk sertifikat SSL</Label>
          <Input
            id="dom-email"
            placeholder="admin@domain-anda.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div>
          <p className="text-sm font-medium">Pasang HTTPS otomatis (Let&apos;s Encrypt)</p>
          <p className="text-xs text-muted-foreground">
            Pastikan domain sudah diarahkan ke IP server ini sebelum diterapkan.
          </p>
        </div>
        <Switch checked={https} onCheckedChange={setHttps} aria-label="Pasang HTTPS otomatis" />
      </div>

      <Button className="mt-4" disabled={busy} onClick={() => void apply()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
        {busy ? "Menerapkan…" : "Simpan & Terapkan ke Server"}
      </Button>

      {log && (
        <pre className="mono-num mt-4 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/60 p-3 text-xs">
          {log}
        </pre>
      )}
    </div>
  );
}
