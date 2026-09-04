import { AppShell } from "@/components/app-shell";
import { LibraryClient } from "@/components/library-client";
import { requirePageUser } from "@/lib/auth";
import { getEpisodes, getSeriesOverview } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await requirePageUser();
  const [series, episodes] = await Promise.all([getSeriesOverview(user.id, true), getEpisodes(user.id)]);
  return <AppShell user={user}><div className="page"><header className="page-header"><div><p className="eyebrow">Dein Katalog</p><h1>Bibliothek</h1><p className="muted">Serien, Sonderfolgen, Termine und Hör-Links an einem Ort.</p></div></header><LibraryClient initialSeries={series} initialEpisodes={episodes} /></div></AppShell>;
}
