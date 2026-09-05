import { AppShell } from "@/components/app-shell";
import { LibraryClient } from "@/components/library-client";
import { OnlineSourcesClient } from "@/components/online-sources-client";
import { requirePageUser } from "@/lib/auth";
import { getEpisodes, getSeriesOverview } from "@/lib/catalog";
import { getImportProposals, getImportSources } from "@/lib/online-import-service";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await requirePageUser();
  const canManage = user.role === "owner" || user.role === "admin";
  const [series, episodes, sources, proposals] = await Promise.all([
    getSeriesOverview(user.id, true), getEpisodes(user.id),
    canManage ? getImportSources() : Promise.resolve([]),
    canManage ? getImportProposals() : Promise.resolve([]),
  ]);
  const confirmedSourceIds = new Set(sources.filter((source) => source.confirmed).map((source) => source.id));
  return <AppShell user={user}><div className="page"><header className="page-header"><div><p className="eyebrow">Dein Katalog</p><h1>Bibliothek</h1><p className="muted">Serien, Sonderfolgen, Termine und Hör-Links an einem Ort.</p></div></header>{canManage && <OnlineSourcesClient initialSources={sources} initialProposals={proposals.filter((item) => item.status === "pending" && confirmedSourceIds.has(item.sourceId))} series={series} episodes={episodes} />}<LibraryClient initialSeries={series} initialEpisodes={episodes} /></div></AppShell>;
}
