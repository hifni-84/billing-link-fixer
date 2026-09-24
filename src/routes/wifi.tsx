import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, LogOut, Router, Save, Wifi } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { wifiPortalInfo, wifiPortalUpdate } from "@/lib/customer-wifi.functions";

export const Route = createFileRoute("/wifi")({
  head: () => ({
    meta: [
      { title: "Ganti Nama & Password WiFi — Portal Pelanggan" },
      {
        name: "description",
        content:
          "Pelanggan internet PPPoE dapat mengganti sendiri nama WiFi (SSID) dan password WiFi langsung dari ponsel.",
      },
      { property: "og:title", content: "Ganti Nama & Password WiFi — Portal Pelanggan" },
      {
        property: "og:description",
        content: "Masuk dengan akun internet Anda untuk mengubah nama dan password WiFi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WifiPortalPage,
});

const tanggal = (v: string | null) =>
  v ? new Date(v).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-";

function WifiPortalPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [lihatAkun, setLihatAkun] = useState(false);

  const [ssid, setSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [lihatWifi, setLihatWifi] = useState(false);
  const [pilih, setPilih] = useState<string[]>([]);

  const masuk = useMutation({
    mutationFn: () =>
      wifiPortalInfo({ data: { username: username.trim(), password } }),
  });

  const info = masuk.data?.ok ? masuk.data.info : null;

  useEffect(() => {
    if (!info) return;
    setPilih(info.bands.map((b) => b.index));
    const utama = info.bands[0];
    setSsid((utama?.ssid ?? "").replace(/-5G$/i, ""));
  }, [info]);

  const simpan = useMutation({
    mutationFn: () =>
      wifiPortalUpdate({
        data: {
          username: username.trim(),
          password,
          indexes: pilih,
          ssid: ssid.trim(),
          wifiPassword,
        },
      }),
  });

  const keluar = () => {
    masuk.reset();
    simpan.reset();
    setPassword("");
    setSsid("");
    setWifiPassword("");
    setPilih([]);
  };

  const toggleBand = (index: string) =>
    setPilih((s) => (s.includes(index) ? s.filter((v) => v !== index) : [...s, index]));

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
          <Wifi className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Pengaturan WiFi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ganti sendiri nama dan password WiFi rumah Anda tanpa menunggu teknisi.
        </p>
      </div>

      {!info ? (
        <form
          className="panel flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim() && password) masuk.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u">Username Internet (PPPoE)</Label>
            <Input
              id="u"
              autoComplete="username"
              placeholder="contoh: budi01"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={64}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p">Password Internet</Label>
            <div className="relative">
              <Input
                id="p"
                type={lihatAkun ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={128}
                className="pr-10"
              />
              <button
                type="button"
                aria-label={lihatAkun ? "Sembunyikan password" : "Lihat password"}
                onClick={() => setLihatAkun((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground"
              >
                {lihatAkun ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" disabled={masuk.isPending || !username.trim() || !password}>
            {masuk.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Masuk
          </Button>

          {masuk.data && !masuk.data.ok && (
            <p className="text-sm text-destructive">{masuk.data.error}</p>
          )}
          {masuk.isError && (
            <p className="text-sm text-destructive">
              Gagal menghubungi server. Coba beberapa saat lagi.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Gunakan username dan password internet yang diberikan saat pemasangan.
          </p>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="panel flex items-start gap-3 p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
              <Router className="size-5" />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                {`${info.device.manufacturer} ${info.device.model}`.trim() || "Modem Pelanggan"}
              </p>
              <p className="text-muted-foreground">
                Akun: {info.username}
                {info.plan ? ` — paket ${info.plan}` : ""}
              </p>
              <p className="text-muted-foreground">Aktif hingga: {tanggal(info.expiresAt)}</p>
              <p className={info.device.online ? "text-primary" : "text-muted-foreground"}>
                {info.device.online
                   ? "Laporan modem sesuai jadwal"
                   : `Laporan modem terlambat (terakhir: ${tanggal(info.device.lastInform)})`}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={keluar}>
              <LogOut className="size-4" />
            </Button>
          </div>

          <form
            className="panel flex flex-col gap-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              simpan.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ssid">Nama WiFi (SSID)</Label>
              <Input
                id="ssid"
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                maxLength={32}
                placeholder="Nama WiFi baru"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wp">Password WiFi baru</Label>
              <div className="relative">
                <Input
                  id="wp"
                  type={lihatWifi ? "text" : "password"}
                  value={wifiPassword}
                  onChange={(e) => setWifiPassword(e.target.value)}
                  maxLength={63}
                  placeholder="Minimal 8 karakter"
                  className="pr-10"
                />
                <button
                  type="button"
                  aria-label={lihatWifi ? "Sembunyikan password" : "Lihat password"}
                  onClick={() => setLihatWifi((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground"
                >
                  {lihatWifi ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Kosongkan bila hanya ingin mengganti nama WiFi saja.
              </p>
            </div>

            {info.bands.length > 1 && (
              <div className="flex flex-col gap-2">
                <Label>Jaringan yang diubah</Label>
                {info.bands.map((b) => (
                  <label key={b.index} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-current"
                      checked={pilih.includes(b.index)}
                      onChange={() => toggleBand(b.index)}
                    />
                    <span>
                      {b.band} — <span className="text-muted-foreground">{b.ssid || "tanpa nama"}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <Button
              type="submit"
              disabled={simpan.isPending || (!ssid.trim() && !wifiPassword) || !pilih.length}
            >
              {simpan.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              Simpan Perubahan
            </Button>

            {simpan.data?.ok && (
              <p className="text-sm text-primary">
                Berhasil disimpan untuk {simpan.data.changed.join(", ") || "WiFi Anda"}. Perangkat
                Anda akan terputus sebentar, lalu sambungkan ulang dengan nama dan password baru.
              </p>
            )}
            {simpan.data && !simpan.data.ok && (
              <p className="text-sm text-destructive">{simpan.data.error}</p>
            )}
            {simpan.isError && (
              <p className="text-sm text-destructive">Gagal menyimpan. Coba beberapa saat lagi.</p>
            )}

            {!info.device.online && (
              <p className="text-xs text-muted-foreground">
                  Laporan modem terlambat; ini belum tentu gangguan internet. Perubahan mungkin menunggu modem menghubungi pengelola kembali.
              </p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
