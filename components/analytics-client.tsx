"use client";

import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { CalendarDays, Check, Clock3, Flame, Headphones, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clientApi } from "@/components/client-api";
import type { AnalyticsData } from "@/lib/types";

type ActivityGrouping = "day" | "week" | "month";

function subtractDays(date: string, count: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - count);
  return value.toISOString().slice(0, 10);
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(new Date(`${value}T12:00:00Z`));
}

function activityBucket(value: string, grouping: ActivityGrouping): string {
  if (grouping === "month") return value.slice(0, 7);
  if (grouping === "week") {
    const date = new Date(`${value}T12:00:00Z`);
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - weekday + 1);
    return date.toISOString().slice(0, 10);
  }
  return value;
}

function activityLabel(value: string, grouping: ActivityGrouping): string {
  if (grouping === "month") {
    return new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit" }).format(new Date(`${value}-01T12:00:00Z`));
  }
  return `${grouping === "week" ? "KW · " : ""}${shortDate(value)}`;
}

export function AnalyticsClient({ initialData }: { initialData: AnalyticsData }) {
  const [data, setData] = useState(initialData);
  const [from, setFrom] = useState(initialData.range.from);
  const [to, setTo] = useState(initialData.range.to);
  const [grouping, setGrouping] = useState<ActivityGrouping>("day");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const chartData = useMemo(() => {
    const grouped = new Map<string, { bucket: string; heard: number; skipped: number; minutes: number }>();
    for (const item of data.activity) {
      const bucket = activityBucket(item.bucket, grouping);
      const current = grouped.get(bucket) ?? { bucket, heard: 0, skipped: 0, minutes: 0 };
      current.heard += item.heard;
      current.skipped += item.skipped;
      current.minutes += item.minutes;
      grouped.set(bucket, current);
    }
    return [...grouped.values()].map((item) => ({ ...item, label: activityLabel(item.bucket, grouping) }));
  }, [data, grouping]);

  async function load(nextFrom = from, nextTo = to) {
    setBusy(true); setError("");
    try {
      const response = await clientApi<{ analytics: AnalyticsData }>(`/api/analytics?from=${nextFrom}&to=${nextTo}`);
      setData(response.analytics); setFrom(nextFrom); setTo(nextTo);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Statistik konnte nicht geladen werden."); }
    finally { setBusy(false); }
  }

  function quickRange(days: number) {
    const nextFrom = subtractDays(to, days - 1);
    void load(nextFrom, to);
  }

  return (
    <div className="stack analytics-stack">
      <Card className="range-card"><div className="row-wrap"><CalendarDays size={18} /><strong>Zeitraum</strong><Button size="sm" variant="ghost" onClick={() => quickRange(7)}>7 Tage</Button><Button size="sm" variant="ghost" onClick={() => quickRange(30)}>30 Tage</Button><Button size="sm" variant="ghost" onClick={() => quickRange(365)}>1 Jahr</Button><span className="grow" /><label>Von<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Bis<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><Button size="sm" onClick={() => load()} disabled={busy || !from || !to}>Anwenden</Button></div>{error && <p className="form-error">{error}</p>}</Card>

      <div className="grid grid-3 analytics-kpis">
        <Metric icon={<Check />} label="Gehört" value={data.heard.toLocaleString("de-DE")} />
        <Metric icon={<SkipForward />} label="Übersprungen" value={data.skipped.toLocaleString("de-DE")} detail={`${data.skipRate.toLocaleString("de-DE")} % Skipquote`} />
        <Metric icon={<Clock3 />} label="Hörzeit" value={`${Math.floor(data.minutes / 60)} Std.`} detail={`${data.minutes % 60} Minuten`} />
        <Metric icon={<Flame />} label="Aktueller Streak" value={`${data.currentStreak} Tage`} />
        <Metric icon={<Flame />} label="Längster Streak" value={`${data.longestStreak} Tage`} />
        <Metric icon={<Headphones />} label="Aktive Serien" value={data.progress.filter((item) => item.totalCount > 0).length.toLocaleString("de-DE")} />
      </div>

      <div className="grid grid-2 analytics-charts">
        <Card><div className="chart-heading"><div><p className="eyebrow">Aktivität</p><h2>Hören und Skippen</h2></div><div className="row-wrap" aria-label="Zeitliche Gruppierung">{(["day", "week", "month"] as const).map((value) => <Button key={value} size="sm" variant={grouping === value ? "primary" : "ghost"} onClick={() => setGrouping(value)}>{value === "day" ? "Tag" : value === "week" ? "Woche" : "Monat"}</Button>)}</div></div><div className="chart-box">{chartData.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ left: -22, right: 8, top: 10, bottom: 0 }}><defs><linearGradient id="heardFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#72c69d" stopOpacity={0.35}/><stop offset="95%" stopColor="#72c69d" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false}/><XAxis dataKey="label" stroke="#777984" fontSize={11} tickLine={false}/><YAxis allowDecimals={false} stroke="#777984" fontSize={11} tickLine={false}/><Tooltip contentStyle={{ background: "#171920", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 }} /><Legend /><Area type="monotone" dataKey="heard" name="Gehört" stroke="#72c69d" fill="url(#heardFill)" strokeWidth={2}/><Area type="monotone" dataKey="skipped" name="Übersprungen" stroke="#e6c66b" fill="transparent" strokeWidth={2}/></AreaChart></ResponsiveContainer> : <ChartEmpty />}</div></Card>
        <Card><div className="chart-heading"><div><p className="eyebrow">Laufzeit</p><h2>Gehörte Minuten</h2></div></div><div className="chart-box">{chartData.some((item) => item.minutes) ? <ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ left: -18, right: 8, top: 10, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false}/><XAxis dataKey="label" stroke="#777984" fontSize={11} tickLine={false}/><YAxis stroke="#777984" fontSize={11} tickLine={false}/><Tooltip contentStyle={{ background: "#171920", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 }} /><Bar dataKey="minutes" name="Minuten" fill="#f0a35b" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer> : <ChartEmpty />}</div></Card>
      </div>

      <div className="grid grid-2 analytics-lists">
        <Card><p className="eyebrow">Favoriten der Statistik</p><h2>Meistgehörte Serien</h2><div className="ranking-list">{data.topSeries.length ? data.topSeries.map((item, index) => <div key={item.name} className="ranking-row"><span>{index + 1}</span><strong className="grow">{item.name}</strong><small>{item.heard} gehört · {Math.floor(item.minutes / 60)}:{String(item.minutes % 60).padStart(2,"0")} Std.</small></div>) : <p className="muted">In diesem Zeitraum gibt es noch keine gehörten Folgen.</p>}</div></Card>
        <Card><p className="eyebrow">Aktuelle Runden</p><h2>Serienfortschritt</h2><div className="progress-list">{data.progress.filter((item) => item.totalCount > 0).map((item) => { const percent = Math.round((item.heardCount / item.totalCount) * 100); return <div key={item.id} className="progress-row"><div className="row space-between"><strong>{item.name}</strong><small>{percent} % · Runde {item.roundNumber}</small></div><div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%`, background: item.accentColor }} /></div></div>; })}</div></Card>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string | number; detail?: string }) {
  return <Card className="metric-card"><span className="metric-icon">{icon}</span><div><span className="stat-label">{label}</span><div className="stat-value">{value}</div>{detail && <small>{detail}</small>}</div></Card>;
}

function ChartEmpty() {
  return <div className="chart-empty"><Headphones size={28} /><span>Noch keine Daten im Zeitraum</span></div>;
}
