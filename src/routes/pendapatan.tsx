import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRadiusReport } from "@/lib/radius-client";
import { formatIDR } from "@/lib/mikrotik-types";

export const Route = createFileRoute("/pendapatan")({
  head: () => ({
    meta: [
      { title: "Pendapatan RADIUS — NAJWA_BILLING" },
      {
        name: "description",
        content:
          "Rekap pendapatan harian 30 hari terakhir dan bulanan 12 bulan terakhir dari voucher dan user RADIUS.",
      },
      { property: "og:title", content: "Pendapatan RADIUS — NAJWA_BILLING" },
      {
        property: "og:description",
        content: "Total pendapatan harian dan bulanan billing NAJWA_BILLING.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PendapatanPage,
});

function PendapatanPage() {
  const report = useRadiusReport();
  const [plan, setPlan] = useState("all");

  const daftarPaket = useMemo(
    () => (report.data?.perPlan ?? []).map((p) => p.plan),
    [report.data],
  );

  const dailyPlans = report.data?.dailyPlans ?? [];

  /** Baris harian mengikuti filter paket yang dipilih. */
  const harian = useMemo(() => {
    if (plan === "all") return [...(report.data?.daily ?? [])].reverse();
    return dailyPlans
      .filter((r) => r.plan === plan)
      .map((r) => ({ date: r.date, count: r.count, total: r.total }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [report.data, dailyPlans, plan]);

  /** Rincian paket per tanggal (mengikuti filter). */
  const rincian = useMemo(
    () =>
      dailyPlans
        .filter((r) => plan === "all" || r.plan === plan)
        .sort((a, b) => b.date.localeCompare(a.date) || b.total - a.total),
    [dailyPlans, plan],
  );

  return (
    <>
      <PageHeader
        title="Pendapatan"
        description="Rekap pendapatan harian dan bulanan."
        action={
          <div className="flex flex-wrap gap-2">
            <Select value={plan} onValueChange={setPlan}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Semua paket" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua paket</SelectItem>
                {daftarPaket.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => report.refetch()}>
              <RefreshCw className="size-4" /> Muat Ulang
            </Button>
          </div>
        }
      />

      {report.data?.error ? (
        <div className="panel mb-4 border-destructive/40 p-4 text-sm text-destructive">
          Gagal membaca data pendapatan dari database: {report.data.error}
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          {
            l: "Pendapatan Hari Ini",
            v: formatIDR(report.data?.todayRevenue ?? 0),
            s: `${report.data?.todayCount ?? 0} voucher`,
          },
          {
            l: "Pendapatan Bulan Ini",
            v: formatIDR(report.data?.monthRevenue ?? 0),
            s: `${report.data?.monthCount ?? 0} voucher`,
          },
          { l: "Total Pendapatan", v: formatIDR(report.data?.totalRevenue ?? 0), s: "" },
        ].map((s) => (
          <div key={s.l} className="panel p-4">
            <p className="text-xs text-muted-foreground">{s.l}</p>
            <p className="mono-num mt-1 text-xl font-semibold">{s.v}</p>
            {s.s ? <p className="mt-0.5 text-xs text-muted-foreground">{s.s}</p> : null}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="panel p-5">
          <h3 className="mb-3 text-sm font-semibold">
            Pendapatan Harian (30 hari)
            {plan !== "all" ? ` — ${plan}` : ""}
          </h3>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">Tanggal</th>
                  <th className="p-2 text-right">Voucher</th>
                  <th className="p-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {harian.map((d) => (
                  <tr key={d.date} className="border-t border-border/50">
                    <td className="p-2">{d.date}</td>
                    <td className="mono-num p-2 text-right">{d.count}</td>
                    <td className="mono-num p-2 text-right">{formatIDR(d.total)}</td>
                  </tr>
                ))}
                {harian.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-muted-foreground">
                      Belum ada data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel p-5">
          <h3 className="mb-3 text-sm font-semibold">Pendapatan Bulanan (12 bulan)</h3>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">Bulan</th>
                  <th className="p-2 text-right">Voucher</th>
                  <th className="p-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {[...(report.data?.monthly ?? [])].reverse().map((m) => (
                  <tr key={m.month} className="border-t border-border/50">
                    <td className="p-2">{m.month}</td>
                    <td className="mono-num p-2 text-right">{m.count}</td>
                    <td className="mono-num p-2 text-right">{formatIDR(m.total)}</td>
                  </tr>
                ))}
                {!report.data?.monthly.length && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-muted-foreground">
                      Belum ada data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel mt-6 p-5">
        <h3 className="mb-3 text-sm font-semibold">Paket Terjual per Tanggal</h3>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Tanggal</th>
                <th className="p-2 text-left">Paket</th>
                <th className="p-2 text-right">Terjual</th>
                <th className="p-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rincian.map((r) => (
                <tr key={`${r.date}-${r.plan}`} className="border-t border-border/50">
                  <td className="p-2">{r.date}</td>
                  <td className="truncate p-2">{r.plan}</td>
                  <td className="mono-num p-2 text-right">{r.count}</td>
                  <td className="mono-num p-2 text-right">{formatIDR(r.total)}</td>
                </tr>
              ))}
              {rincian.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-muted-foreground">
                    Belum ada data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
