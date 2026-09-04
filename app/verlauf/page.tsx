import { AppShell } from "@/components/app-shell";
import { HistoryClient } from "@/components/history-client";
import { requirePageUser } from "@/lib/auth";
import { getHistory } from "@/lib/randomizer";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await requirePageUser();
  const items = await getHistory(user.id, 250);
  return <AppShell user={user}><div className="page"><header className="page-header"><div><p className="eyebrow">Jede Entscheidung bleibt nachvollziehbar</p><h1>Verlauf</h1><p className="muted">Hörmomente, Skips und Korrekturen – über alle Runden hinweg.</p></div></header><HistoryClient initialItems={items} /></div></AppShell>;
}
