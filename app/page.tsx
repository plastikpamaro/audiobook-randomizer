import { AppShell } from "@/components/app-shell";
import { DrawClient } from "@/components/draw-client";
import { requirePageUser } from "@/lib/auth";
import { getPresets, getSeriesOverview } from "@/lib/catalog";
import { getCurrentDraw } from "@/lib/randomizer";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requirePageUser();
  const [series, presets, current] = await Promise.all([
    getSeriesOverview(user.id), getPresets(user.id), getCurrentDraw(user.id),
  ]);
  return (
    <AppShell user={user}>
      <div className="page">
        <header className="page-header">
          <div><p className="eyebrow">Heute hören</p><h1>Überlass die nächste Folge dem Zufall.</h1><p className="muted">Du wählst die Serien. Der Beutel kümmert sich darum, dass nichts doppelt kommt.</p></div>
        </header>
        <DrawClient initialSeries={series} initialPresets={presets} initialDraw={current} />
      </div>
    </AppShell>
  );
}
