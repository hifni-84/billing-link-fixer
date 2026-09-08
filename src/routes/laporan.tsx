import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from "recharts";

import { PageHeader } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIDR } from "@/lib/mikrotik-types";
import { useRadiusReport } from "@/lib/radius-client";

export const Route = createFileRoute("/laporan")({
  head: () => ({
    meta: [
      { title: "Laporan Pendapatan — BILLING RADIUS" },
      {
        name: "description",
        content:
          "Laporan penjualan voucher hotspot: pendapatan harian, rekap per paket, dan ekspor CSV.",
      },
      { property: "og:title", content: "Laporan Pendapatan — BILLING RADIUS" },
      {
        property: "og:description",
        content: "Rekap omzet voucher hotspot harian dan per paket, lengkap dengan ekspor CSV.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LaporanPage,
});

function LaporanPage() {
  const report = useRadiusReport();
  const [range, setRange] = useState("30");
  const [plan, setPlan] = useState("all");
  const [service, setService] = useState("all");
  const [bulan, setBulan] = useState("0");

  const planOptions = useMemo(
    () =>
      (report.data?.perPlan ?? [])
        .filter((p) => service === "all" || p.service === service)
        .map((p) => p.plan)
        .sort((a, b) => a.localeCompare(b)),
    [report.data, service],
  );

  const view = useMemo(() => {
    const limit = Number(range);
    const since =
      limit === 0 ? "" : new Date(Date.now() - limit * 86400000).toISOString().slice(0, 10);
    const inPeriode = (date: string) =>
      bulan !== "0" ? date.slice(5, 7) === bulan.padStart(2, "0") : limit === 0 || date >= since;
    const dailyPlans = (report.data?.dailyPlans ?? []).filter(
      (d) =>
        inPeriode(d.date) &&
        (plan === "all" || d.plan === plan) &&
        (service === "all" || d.service === service),
    );

    let filtered: { date: string; total: number; count: number }[];
    if (plan === "all" && service === "all") {
      filtered = (report.data?.daily ?? []).filter((d) => inPeriode(d.date));
    } else {
      const map = new Map<string, { total: number; count: number }>();
      for (const d of dailyPlans) {
        const cur = map.get(d.date) ?? { total: 0, count: 0 };
        map.set(d.date, { total: cur.total + d.total, count: cur.count + d.count });
      }
      filtered = [...map.entries()].map(([date, v]) => ({ date, ...v }));
    }

    const perPlanMap = new Map<string, { total: number; count: number }>();
    for (const d of dailyPlans) {
      const cur = perPlanMap.get(d.plan) ?? { total: 0, count: 0 };
      perPlanMap.set(d.plan, { total: cur.total + d.total, count: cur.count + d.count });
    }
    const perPlanRows = [...perPlanMap.entries()]
      .map(([p, v]) => ({ plan: p, ...v }))
      .sort((a, b) => b.count - a.count);

    return {
      rows: [...filtered].sort((a, b) => b.date.localeCompare(a.date)),
      chart: [...filtered]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({ date: d.date.slice(5), total: d.total })),
      perPlan:
        perPlanRows.length > 0
          ? perPlanRows
          : plan === "all"
            ? (report.data?.perPlan ?? []).filter(
                (p) => service === "all" || p.service === service,
              )
            : [],
      dailyPlans: [...dailyPlans].sort(
        (a, b) => b.date.localeCompare(a.date) || b.count - a.count,
      ),
      total: filtered.reduce((s, d) => s + d.total, 0),
      count: filtered.reduce((s, d) => s + d.count, 0),
      unsold: report.data?.unsold ?? 0,
    };
  }, [report.data, range, plan, service, bulan]);

  const exportCsv = () => {
    const lines = ["tanggal,profil_voucher,jumlah_voucher,pendapatan"];
    for (const d of view.dailyPlans) lines.push(`${d.date},${d.plan},${d.count},${d.total}`);
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-hotspot-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Laporan Pendapatan"
        description="Sumber data sama dengan menu Pendapatan (harga modal voucher)."
        action={
          <div className="flex flex-wrap gap-2">
            <Select value={range} onValueChange={setRange} disabled={bulan !== "0"}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 hari</SelectItem>
                <SelectItem value="30">30 hari</SelectItem>
                <SelectItem value="90">90 hari</SelectItem>
                <SelectItem value="0">Semua</SelectItem>
              </SelectContent>
            </Select>
            <Select value={bulan} onValueChange={setBulan}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Semua bulan</SelectItem>
                {[
                  "Januari",
                  "Februari",
                  "Maret",
                  "April",
                  "Mei",
                  "Juni",
                  "Juli",
                  "Agustus",
                  "September",
                  "Oktober",
                  "November",
                  "Desember",
                ].map((nama, i) => (
                  <SelectItem key={nama} value={String(i + 1)}>
                    {nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={service}
              onValueChange={(v) => {
                setService(v);
                setPlan("all");
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua jenis</SelectItem>
                <SelectItem value="hotspot">Voucher Hotspot</SelectItem>
                <SelectItem value="pppoe">Bulanan (PPPoE)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={plan} onValueChange={setPlan}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Profil voucher" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua profil</SelectItem>
                {planOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => report.refetch()}>
              <RefreshCw className="size-4" /> Muat Ulang
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={view.dailyPlans.length === 0}>
              <Download className="size-4" /> CSV
            </Button>
          </div>
        }
      />

      {report.data?.error ? (
        <div className="panel mb-4 border-destructive/40 p-4 text-sm text-destructive">
          Gagal membaca data laporan dari database: {report.data.error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Total Omzet</p>
          <p className="mono-num mt-2 text-2xl font-semibold text-primary">
            {formatIDR(view.total)}
          </p>
        </div>
        <div className="panel p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Voucher Terjual
          </p>
          <p className="mono-num mt-2 text-2xl font-semibold">{view.count}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Profil: {plan === "all" ? "semua profil" : plan} ·{" "}
            {service === "all"
              ? "semua jenis"
              : service === "pppoe"
                ? "bulanan (PPPoE)"
                : "voucher hotspot"}
          </p>
        </div>
        <div className="panel p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Stok Tersisa</p>
          <p className="mono-num mt-2 text-2xl font-semibold">{view.unsold}</p>
        </div>
      </div>

      <div className="panel mt-6 p-5">
        <h2 className="text-sm font-semibold">Grafik Pendapatan Harian</h2>
        <div className="mt-4 h-64">
          {view.chart.length === 0 ? (
            <p className="pt-16 text-center text-sm text-muted-foreground">Belum ada data.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.chart}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} width={70} />
                <ReTooltip
                  cursor={{ fill: "var(--color-secondary)" }}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    color: "var(--color-foreground)",
                  }}
                  formatter={(v: number) => formatIDR(v)}
                />
                <Bar dataKey="total" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="panel overflow-hidden">
          <h2 className="border-b border-border p-4 text-sm font-semibold">Rincian Harian</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Voucher</TableHead>
                <TableHead className="text-right">Pendapatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.rows.map((d) => (
                <TableRow key={d.date}>
                  <TableCell className="mono-num">{d.date}</TableCell>
                  <TableCell className="mono-num">{d.count}</TableCell>
                  <TableCell className="mono-num text-right">{formatIDR(d.total)}</TableCell>
                </TableRow>
              ))}
              {view.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    Belum ada penjualan pada periode ini.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="panel overflow-hidden">
          <h2 className="border-b border-border p-4 text-sm font-semibold">
            Total Terjual per Profil Voucher
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profil</TableHead>
                <TableHead>Terjual</TableHead>
                <TableHead className="text-right">Pendapatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.perPlan.map((p) => (
                <TableRow key={p.plan}>
                  <TableCell className="truncate">{p.plan}</TableCell>
                  <TableCell className="mono-num">{p.count}</TableCell>
                  <TableCell className="mono-num text-right">{formatIDR(p.total)}</TableCell>
                </TableRow>
              ))}
              {view.perPlan.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    Belum ada data paket.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="panel mt-6 overflow-hidden">
        <h2 className="border-b border-border p-4 text-sm font-semibold">
          Rincian Terjual per Tanggal &amp; Profil
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead>Profil</TableHead>
              <TableHead>Terjual</TableHead>
              <TableHead className="text-right">Pendapatan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.dailyPlans.map((d) => (
              <TableRow key={`${d.date}-${d.plan}`}>
                <TableCell className="mono-num">{d.date}</TableCell>
                <TableCell className="truncate">{d.plan}</TableCell>
                <TableCell className="mono-num">{d.count}</TableCell>
                <TableCell className="mono-num text-right">{formatIDR(d.total)}</TableCell>
              </TableRow>
            ))}
            {view.dailyPlans.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Belum ada penjualan pada filter ini.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
