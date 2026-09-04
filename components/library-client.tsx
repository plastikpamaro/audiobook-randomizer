"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Archive, BookPlus, CalendarClock, Check, FileUp, Heart,
  Pencil, Plus, RotateCcw, Search, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clientApi } from "@/components/client-api";
import type { CsvImportIssue, CsvImportPreview } from "@/lib/csv-import";
import type { EpisodeLink, EpisodeSummary, SeriesOverview } from "@/lib/types";

interface EpisodeDraft {
  id?: string;
  seriesId: string;
  episodeKey: string;
  numberLabel: string;
  sortOrder: string;
  title: string;
  releaseDate: string;
  durationMinutes: string;
  priorityOnRelease: boolean;
  archived: boolean;
  favorite: boolean;
  note: string;
  links: Array<Pick<EpisodeLink, "label" | "url" | "sortOrder">>;
}

function episodeDraft(episode: EpisodeSummary | null, seriesId: string): EpisodeDraft {
  return episode ? {
    id: episode.id,
    seriesId: episode.seriesId,
    episodeKey: episode.episodeKey,
    numberLabel: episode.numberLabel || "",
    sortOrder: episode.sortOrder?.toString() || "",
    title: episode.title,
    releaseDate: episode.releaseDate || "",
    durationMinutes: episode.durationMinutes?.toString() || "",
    priorityOnRelease: episode.priorityOnRelease,
    archived: episode.archived,
    favorite: episode.favorite,
    note: episode.note,
    links: episode.links.map((link) => ({ label: link.label, url: link.url, sortOrder: link.sortOrder })),
  } : {
    seriesId,
    episodeKey: "",
    numberLabel: "",
    sortOrder: "",
    title: "",
    releaseDate: "",
    durationMinutes: "",
    priorityOnRelease: false,
    archived: false,
    favorite: false,
    note: "",
    links: [],
  };
}

const statusLabels: Record<EpisodeSummary["status"], string> = {
  available: "Verfügbar", heard: "Gehört", future: "Geplant", archived: "Archiviert",
};

export function LibraryClient({ initialSeries, initialEpisodes }: { initialSeries: SeriesOverview[]; initialEpisodes: EpisodeSummary[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [seriesFilter, setSeriesFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [releaseFrom, setReleaseFrom] = useState("");
  const [releaseTo, setReleaseTo] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [episodeEditor, setEpisodeEditor] = useState<EpisodeDraft | null>(null);
  const [seriesEditor, setSeriesEditor] = useState<SeriesOverview | "new" | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("de");
    return initialEpisodes.filter((episode) => {
      if (seriesFilter !== "all" && episode.seriesId !== seriesFilter) return false;
      if (statusFilter !== "all" && episode.status !== statusFilter) return false;
      if (favoritesOnly && !episode.favorite) return false;
      if (releaseFrom && (!episode.releaseDate || episode.releaseDate < releaseFrom)) return false;
      if (releaseTo && (!episode.releaseDate || episode.releaseDate > releaseTo)) return false;
      return !needle || `${episode.seriesName} ${episode.numberLabel || ""} ${episode.title}`.toLocaleLowerCase("de").includes(needle);
    });
  }, [favoritesOnly, initialEpisodes, releaseFrom, releaseTo, search, seriesFilter, statusFilter]);

  function toggleSelected(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function bulk(action: "heard" | "available" | "archive" | "unarchive") {
    setBusy(true); setMessage("");
    try {
      await clientApi("/api/episodes/bulk", { method: "POST", body: JSON.stringify({ episodeIds: selected, action }) });
      setSelected([]); setMessage("Auswahl aktualisiert."); router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Aktion fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  async function saveSeries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const existing = seriesEditor !== "new" ? seriesEditor : null;
      await clientApi(existing ? `/api/series/${existing.id}` : "/api/series", {
        method: existing ? "PATCH" : "POST",
        body: JSON.stringify({
          seriesKey: form.get("seriesKey"), name: form.get("name"), description: form.get("description"),
          accentColor: form.get("accentColor"), archived: existing?.archived || false,
        }),
      });
      setSeriesEditor(null); router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Serie konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  async function toggleSeriesArchive(series: SeriesOverview) {
    setBusy(true); setMessage("");
    try {
      await clientApi(`/api/series/${series.id}`, { method: "PATCH", body: JSON.stringify({ archived: !series.archived }) });
      router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Serie konnte nicht aktualisiert werden."); }
    finally { setBusy(false); }
  }

  async function resetSeries(series: SeriesOverview) {
    if (!window.confirm(`Neue Runde für „${series.name}“ starten? Der bisherige Verlauf bleibt erhalten.`)) return;
    setBusy(true); setMessage("");
    try {
      await clientApi("/api/rounds/reset", { method: "POST", body: JSON.stringify({ seriesIds: [series.id] }) });
      setMessage(`Neue Runde für ${series.name} gestartet.`); router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Runde konnte nicht gestartet werden."); }
    finally { setBusy(false); }
  }

  async function saveEpisode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!episodeEditor) return;
    setBusy(true); setMessage("");
    const body = {
      seriesId: episodeEditor.seriesId,
      episodeKey: episodeEditor.episodeKey,
      numberLabel: episodeEditor.numberLabel || null,
      sortOrder: episodeEditor.sortOrder ? Number(episodeEditor.sortOrder) : null,
      title: episodeEditor.title,
      releaseDate: episodeEditor.releaseDate || null,
      durationMinutes: episodeEditor.durationMinutes ? Number(episodeEditor.durationMinutes) : null,
      priorityOnRelease: episodeEditor.priorityOnRelease,
      archived: episodeEditor.archived,
      links: episodeEditor.links.filter((link) => link.label && link.url),
    };
    try {
      const result = await clientApi<{ id?: string }>(episodeEditor.id ? `/api/episodes/${episodeEditor.id}` : "/api/episodes", {
        method: episodeEditor.id ? "PATCH" : "POST", body: JSON.stringify(body),
      });
      const id = episodeEditor.id || result.id;
      if (id) {
        await clientApi(`/api/episodes/${id}/preference`, {
          method: "PATCH", body: JSON.stringify({ favorite: episodeEditor.favorite, note: episodeEditor.note }),
        });
      }
      setEpisodeEditor(null); router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Folge konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  async function previewImport() {
    setBusy(true); setMessage("");
    try { setPreview(await clientApi<CsvImportPreview>("/api/import/preview", { method: "POST", body: JSON.stringify({ csv }) })); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Vorschau fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  async function commitImport() {
    setBusy(true); setMessage("");
    try {
      await clientApi("/api/import/commit", { method: "POST", body: JSON.stringify({ csv }) });
      setShowImport(false); setPreview(null); setCsv(""); setMessage("Import vollständig übernommen."); router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Import fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  function updateLink(index: number, field: "label" | "url", value: string) {
    if (!episodeEditor) return;
    const links = episodeEditor.links.map((link, itemIndex) => itemIndex === index ? { ...link, [field]: value } : link);
    setEpisodeEditor({ ...episodeEditor, links });
  }

  return (
    <>
      <div className="library-summary grid grid-3">
        <Card><span className="stat-label">Serien</span><div className="stat-value">{initialSeries.filter((item) => !item.archived).length}</div><small>{initialSeries.filter((item) => item.archived).length} archiviert</small></Card>
        <Card><span className="stat-label">Folgen im Katalog</span><div className="stat-value">{initialEpisodes.length}</div><small>inklusive Sonderfolgen</small></Card>
        <Card><span className="stat-label">Noch verfügbar</span><div className="stat-value">{initialEpisodes.filter((item) => item.status === "available").length}</div><small>in den aktuellen Runden</small></Card>
      </div>

      <Card className="library-card">
        <div className="toolbar">
          <label className="toolbar-search">Suche<span className="input-with-icon"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Titel, Nummer oder Serie" /></span></label>
          <label>Serie<select value={seriesFilter} onChange={(event) => setSeriesFilter(event.target.value)}><option value="all">Alle Serien</option>{initialSeries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Alle Status</option><option value="available">Verfügbar</option><option value="heard">Gehört</option><option value="future">Geplant</option><option value="archived">Archiviert</option></select></label>
          <label>Erschienen ab<input type="date" value={releaseFrom} onChange={(event) => setReleaseFrom(event.target.value)} /></label>
          <label>Erschienen bis<input type="date" value={releaseTo} onChange={(event) => setReleaseTo(event.target.value)} /></label>
          <label className="check-label"><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />Nur Favoriten</label>
        </div>
        <div className="row-wrap library-actions">
          <Button onClick={() => setEpisodeEditor(episodeDraft(null, initialSeries.find((item) => !item.archived)?.id || ""))} disabled={!initialSeries.some((item) => !item.archived)}><BookPlus size={17} />Folge anlegen</Button>
          <Button variant="secondary" onClick={() => setSeriesEditor("new")}><Plus size={17} />Serie anlegen</Button>
          <Button variant="secondary" onClick={() => setShowImport(true)}><FileUp size={17} />CSV importieren</Button>
        </div>
        {selected.length > 0 && (
          <div className="bulk-bar"><strong>{selected.length} ausgewählt</strong><Button size="sm" onClick={() => bulk("heard")} disabled={busy}><Check size={15} />Gehört</Button><Button size="sm" variant="secondary" onClick={() => bulk("available")} disabled={busy}><RotateCcw size={15} />Verfügbar</Button><Button size="sm" variant="secondary" onClick={() => bulk("archive")} disabled={busy}><Archive size={15} />Archivieren</Button><Button size="sm" variant="secondary" onClick={() => bulk("unarchive")} disabled={busy}><Archive size={15} />Reaktivieren</Button><Button size="sm" variant="ghost" onClick={() => setSelected([])}>Aufheben</Button></div>
        )}
        {message && <p className={message.includes("fehl") || message.includes("nicht") ? "form-error" : "form-success"} role="status">{message}</p>}
        <div className="episode-table-wrap">
          <table className="episode-table">
            <thead><tr><th><span className="sr-only">Auswahl</span></th><th>Folge</th><th>Serie</th><th>Status</th><th>Termin</th><th><span className="sr-only">Bearbeiten</span></th></tr></thead>
            <tbody>
              {filtered.map((episode) => (
                <tr key={episode.id}>
                  <td><input type="checkbox" checked={selected.includes(episode.id)} onChange={() => toggleSelected(episode.id)} aria-label={`${episode.title} auswählen`} /></td>
                  <td><div className="episode-title-cell"><span className="series-dot" style={{ background: episode.accentColor }} /><span><strong>{episode.numberLabel ? `${episode.numberLabel} · ` : ""}{episode.title}</strong><small>{episode.durationMinutes ? `${episode.durationMinutes} Min.` : "Keine Laufzeit"}{episode.links.length ? ` · ${episode.links.length} Link${episode.links.length > 1 ? "s" : ""}` : ""}</small></span>{episode.favorite && <Heart size={14} fill="currentColor" />}</div></td>
                  <td>{episode.seriesName}</td>
                  <td><Badge tone={episode.status === "available" ? "good" : episode.status === "future" ? "warn" : "neutral"}>{statusLabels[episode.status]}</Badge></td>
                  <td>{episode.releaseDate || "–"}</td>
                  <td><Button variant="ghost" size="sm" onClick={() => setEpisodeEditor(episodeDraft(episode, episode.seriesId))} aria-label={`${episode.title} bearbeiten`}><Pencil size={16} /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <div className="empty-state"><Search size={32} /><h3>Keine passende Folge</h3><p className="muted">Ändere Suche oder Filter.</p></div>}
        </div>
      </Card>

      <Card className="series-admin-card">
        <div className="row space-between"><div><p className="eyebrow">Serienverwaltung</p><h2>Runden und Kataloge</h2></div></div>
        <div className="series-admin-list">
          {initialSeries.map((item) => <div key={item.id} className="series-admin-row"><span className="series-dot" style={{ background: item.accentColor }} /><span className="grow"><strong>{item.name}</strong><small>{item.seriesKey} · Runde {item.roundNumber} · {item.totalCount} veröffentlicht</small></span>{item.archived && <Badge>Archiviert</Badge>}<Button size="sm" variant="ghost" onClick={() => setSeriesEditor(item)} aria-label={`${item.name} bearbeiten`}><Pencil size={15} /></Button><Button size="sm" variant="ghost" onClick={() => resetSeries(item)} disabled={busy || item.archived}><RotateCcw size={15} />Neue Runde</Button><Button size="sm" variant="ghost" onClick={() => toggleSeriesArchive(item)} disabled={busy}>{item.archived ? "Reaktivieren" : "Archivieren"}</Button></div>)}
        </div>
      </Card>

      {episodeEditor && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="episode-editor-title">
            <div className="modal-header"><div><p className="eyebrow">Katalog</p><h2 id="episode-editor-title">{episodeEditor.id ? "Folge bearbeiten" : "Neue Folge"}</h2></div><Button variant="ghost" onClick={() => setEpisodeEditor(null)} aria-label="Schließen"><X size={20} /></Button></div>
            <form onSubmit={saveEpisode} className="stack">
              <div className="form-grid"><label>Serie<select required value={episodeEditor.seriesId} onChange={(event) => setEpisodeEditor({ ...episodeEditor, seriesId: event.target.value })}>{initialSeries.filter((item) => !item.archived || item.id === episodeEditor.seriesId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Stabiler Schlüssel<input required pattern="[a-z0-9][a-z0-9_-]*" value={episodeEditor.episodeKey} onChange={(event) => setEpisodeEditor({ ...episodeEditor, episodeKey: event.target.value.toLowerCase() })} placeholder="folge-001" /></label></div>
              <label>Titel<input required value={episodeEditor.title} onChange={(event) => setEpisodeEditor({ ...episodeEditor, title: event.target.value })} /></label>
              <div className="form-grid form-grid-3"><label>Nummer (optional)<input value={episodeEditor.numberLabel} onChange={(event) => setEpisodeEditor({ ...episodeEditor, numberLabel: event.target.value })} placeholder="001 oder leer" /></label><label>Sortierung<input type="number" min="1" value={episodeEditor.sortOrder} onChange={(event) => setEpisodeEditor({ ...episodeEditor, sortOrder: event.target.value })} /></label><label>Laufzeit in Min.<input type="number" min="1" value={episodeEditor.durationMinutes} onChange={(event) => setEpisodeEditor({ ...episodeEditor, durationMinutes: event.target.value })} /></label></div>
              <div className="form-grid"><label>Veröffentlichung<input type="date" value={episodeEditor.releaseDate} onChange={(event) => setEpisodeEditor({ ...episodeEditor, releaseDate: event.target.value })} /></label><label className="check-label editor-check"><input type="checkbox" checked={episodeEditor.priorityOnRelease} onChange={(event) => setEpisodeEditor({ ...episodeEditor, priorityOnRelease: event.target.checked })} /><CalendarClock size={17} />Bei Veröffentlichung priorisieren</label></div>
              <div><div className="row space-between"><label>Hör-Links</label><Button type="button" variant="ghost" size="sm" onClick={() => setEpisodeEditor({ ...episodeEditor, links: [...episodeEditor.links, { label: "", url: "", sortOrder: episodeEditor.links.length }] })}><Plus size={15} />Link</Button></div>{episodeEditor.links.map((link, index) => <div className="link-editor" key={index}><input aria-label="Link-Name" placeholder="z. B. Spotify" value={link.label} onChange={(event) => updateLink(index, "label", event.target.value)} /><input aria-label="Link-URL" type="url" placeholder="https://…" value={link.url} onChange={(event) => updateLink(index, "url", event.target.value)} /><Button type="button" variant="ghost" onClick={() => setEpisodeEditor({ ...episodeEditor, links: episodeEditor.links.filter((_, itemIndex) => itemIndex !== index) })} aria-label="Link entfernen"><X size={16} /></Button></div>)}</div>
              <label>Private Notiz<textarea value={episodeEditor.note} onChange={(event) => setEpisodeEditor({ ...episodeEditor, note: event.target.value })} /></label>
              <div className="row-wrap"><label className="check-label"><input type="checkbox" checked={episodeEditor.favorite} onChange={(event) => setEpisodeEditor({ ...episodeEditor, favorite: event.target.checked })} /><Heart size={16} />Favorit</label><label className="check-label"><input type="checkbox" checked={episodeEditor.archived} onChange={(event) => setEpisodeEditor({ ...episodeEditor, archived: event.target.checked })} /><Archive size={16} />Archiviert</label></div>
              {message && <p className="form-error">{message}</p>}
              <div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setEpisodeEditor(null)}>Abbrechen</Button><Button type="submit" disabled={busy}>{busy ? "Speichert…" : "Speichern"}</Button></div>
            </form>
          </section>
        </div>
      )}

      {seriesEditor && (
        <div className="modal-backdrop"><section className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="series-editor-title"><div className="modal-header"><div><p className="eyebrow">Katalog</p><h2 id="series-editor-title">{seriesEditor === "new" ? "Neue Serie" : "Serie bearbeiten"}</h2></div><Button variant="ghost" onClick={() => setSeriesEditor(null)}><X size={20} /></Button></div><form key={seriesEditor === "new" ? "new" : seriesEditor.id} onSubmit={saveSeries} className="stack"><label>Name<input name="name" required defaultValue={seriesEditor === "new" ? "" : seriesEditor.name} /></label><label>Stabiler Schlüssel<input name="seriesKey" required pattern="[a-z0-9][a-z0-9_-]*" placeholder="die-drei-fragezeichen" defaultValue={seriesEditor === "new" ? "" : seriesEditor.seriesKey} /></label><label>Beschreibung<textarea name="description" defaultValue={seriesEditor === "new" ? "" : seriesEditor.description} /></label><label>Akzentfarbe<input name="accentColor" type="color" defaultValue={seriesEditor === "new" ? "#f0a35b" : seriesEditor.accentColor} /></label>{message && <p className="form-error">{message}</p>}<div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setSeriesEditor(null)}>Abbrechen</Button><Button type="submit" disabled={busy}>{seriesEditor === "new" ? "Serie anlegen" : "Änderungen speichern"}</Button></div></form></section></div>
      )}

      {showImport && (
        <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><div className="modal-header"><div><p className="eyebrow">Sammelimport</p><h2 id="import-title">CSV prüfen und übernehmen</h2></div><Button variant="ghost" onClick={() => setShowImport(false)}><X size={20} /></Button></div><div className="stack"><label>CSV-Datei<input type="file" accept=".csv,text/csv" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { setCsv(await file.text()); setPreview(null); } }} /></label><p className="muted csv-help">Pflicht: series_key, series_name, episode_key, title. Optional: number_label, sort_order, release_date, duration_minutes, priority_on_release, link_label, link_url, archived.</p>{csv && <textarea className="csv-preview" value={csv} onChange={(event) => { setCsv(event.target.value); setPreview(null); }} aria-label="CSV-Inhalt" />}{preview && <ImportResult preview={preview} />}{message && <p className="form-error">{message}</p>}<div className="modal-actions"><Button variant="secondary" onClick={previewImport} disabled={!csv || busy}>Vorschau prüfen</Button><Button onClick={commitImport} disabled={!preview || preview.issues.length > 0 || busy}>Import übernehmen</Button></div></div></section></div>
      )}
    </>
  );
}

function ImportResult({ preview }: { preview: CsvImportPreview }) {
  return preview.issues.length ? <div className="import-result import-errors"><strong>{preview.issues.length} Fehler</strong><ul>{preview.issues.slice(0, 20).map((issue: CsvImportIssue, index) => <li key={index}>Zeile {issue.row}{issue.field ? ` · ${issue.field}` : ""}: {issue.message}</li>)}</ul></div> : <div className="import-result import-ok"><Check size={20} /><span><strong>Bereit zum Import</strong><small>{preview.summary.series} Serien · {preview.summary.episodes} Folgen · {preview.summary.links} Links</small></span></div>;
}
