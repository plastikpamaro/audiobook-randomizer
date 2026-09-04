import { AppShell } from "@/components/app-shell";
import { AnalyticsClient } from "@/components/analytics-client";
import { requirePageUser } from "@/lib/auth";
import { getAnalytics } from "@/lib/analytics";
import { localDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function StatisticsPage() {
  const user = await requirePageUser();
  const to = localDate();
  const value = new Date(`${to}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 29);
  const data = await getAnalytics(user.id, value.toISOString().slice(0, 10), to);
  return <AppShell user={user}><div className="page"><header className="page-header"><div><p className="eyebrow">Deine Hörgewohnheiten</p><h1>Statistik</h1><p className="muted">Echte Abschlüsse, stabile Laufzeiten und jede Runde im Blick.</p></div></header><AnalyticsClient initialData={data} /></div></AppShell>;
}
