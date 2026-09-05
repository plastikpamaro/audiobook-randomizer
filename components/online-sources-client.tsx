"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CloudDownload, History, Link2, Pause, Play, RefreshCw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clientApi } from "@/components/client-api";
import type { EpisodeSummary, SeriesOverview } from "@/lib/types";
import type {
  ImportPreviewResult,
  ImportProposalSummary,
  ImportRunSummary,
  ImportSourceKind,
  ImportSourceSummary,
} from "@/lib/online-import-types";

const kindLabels: Record<ImportSourceKind, string> = {
  drei_fragezeichen: "Die drei ??? – offizieller Katalog",
  tkkg: "TKKG – offizieller Katalog",
  csv: "Öffentliche CSV-URL",
  json: "Öffentlicher JSON-Feed",
  rss: "Öffentlicher RSS-/Podcast-Feed",
};

const statusLabels: Record<ImportRunSummary["status"], string> = {
  running: "Läuft",
  awaiting_confirmation: "Bestätigung offen",
  succeeded: "Erfolgreich",
  failed: "Fehlgeschlagen",
  needs_review: "Prüfung nötig",
  not_modified: "Unverändert",
};

type Resolution = { action: "create" | "link" | "ignore"; episodeId?: string };

export function OnlineSourcesClient({
  initialSources,
  initialProposals,
  series,
  episodes,
}: {
  initialSources: ImportSourceSummary[];
  initialProposals: ImportProposalSummary[];
  series: SeriesOverview[];
  episodes: EpisodeSummary[];
}) {
  const router = useRouter();
  const [sources, setSources] = useState(initialSources);
  const [proposals, setProposals] = useState(initialProposals);
  const [showWizard, setShowWizard] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [runs, setRuns] = useState<{ source: ImportSourceSummary; items: ImportRunSummary[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);

  async function reload() {
    const data = await clientApi<{ sources: ImportSourceSummary[]; proposals: ImportProposalSummary[] }>("/api/import-sources", { cache: "no-store" });
    setSources(data.sources); setProposals(data.proposals);
  }

  async function createAndPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("create"); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      let seriesId = String(form.get("seriesId") || "");
      if (seriesId === "new") {
        const created = await clientApi<{ id: string }>("/api/series", {
          method: "POST",
          body: JSON.stringify({
            seriesKey: form.get("newSeriesKey"), name: form.get("newSeriesName"),
            description: "", accentColor: form.get("accentColor"), archived: false,
          }),
        });
        seriesId = created.id;
      }
      const kind = String(form.get("kind")) as ImportSourceKind;
      const created = await clientApi<{ id: string }>("/api/import-sources", {
        method: "POST",
        body: JSON.stringify({ seriesId, kind, name: form.get("name"), url: form.get("url") || null }),
      });
      const result = await clientApi<ImportPreviewResult>("/api/import-sources/preview", {
        method: "POST", body: JSON.stringify({ sourceId: created.id }),
      });
      openPreview(result);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Quelle konnte nicht geprüft werden."); }
    finally { await reload().catch(() => undefined); setBusy(null); }
  }

  function openPreview(result: ImportPreviewResult) {
    setPreview(result);
    setShowWizard(false);
    setResolutions(Object.fromEntries(result.proposals.map((proposal) => [proposal.id, {
      action: proposal.proposalType === "link" ? "link" : "create",
      episodeId: proposal.candidateEpisodeId || undefined,
    }])));
  }

  async function previewExisting(sourceId: string) {
    setBusy(sourceId); setMessage("");
    try {
      openPreview(await clientApi<ImportPreviewResult>("/api/import-sources/preview", { method: "POST", body: JSON.stringify({ sourceId }) }));
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Vorschau fehlgeschlagen."); }
    finally { setBusy(null); }
  }

  async function commitPreview() {
    if (!preview) return;
    setBusy("commit"); setMessage("");
    try {
      await clientApi("/api/import-sources/commit", {
        method: "POST",
        body: JSON.stringify({ runId: preview.run.id, resolutions: preview.proposals.map((proposal) => ({ proposalId: proposal.id, ...resolutions[proposal.id] })) }),
      });
      setPreview(null); setMessage("Quelle bestätigt und tägliche Synchronisierung aktiviert.");
      await reload(); router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Import konnte nicht übernommen werden."); }
    finally { setBusy(null); }
  }

  async function sync(sourceId: string) {
    setBusy(sourceId); setMessage("");
    try {
      const result = await clientApi<{ run: ImportRunSummary }>(`/api/import-sources/${sourceId}/sync`, { method: "POST" });
      setMessage(result.run.status === "needs_review" ? "Prüfung beendet: Es gibt Auffälligkeiten oder Vorschläge." : "Quelle wurde geprüft.");
      await reload(); router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Synchronisierung fehlgeschlagen."); }
    finally { setBusy(null); }
  }

  async function toggle(source: ImportSourceSummary) {
    setBusy(source.id); setMessage("");
    try {
      await clientApi(`/api/import-sources/${source.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !source.enabled }) });
      await reload();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Quelle konnte nicht aktualisiert werden."); }
    finally { setBusy(null); }
  }

  async function remove(source: ImportSourceSummary) {
    if (!window.confirm(`„${source.name}“ deaktivieren? Bereits importierte Folgen und Zuordnungen bleiben erhalten.`)) return;
    setBusy(source.id); setMessage("");
    try { await clientApi(`/api/import-sources/${source.id}`, { method: "DELETE" }); await reload(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Quelle konnte nicht entfernt werden."); }
    finally { setBusy(null); }
  }

  async function showRuns(source: ImportSourceSummary) {
    setBusy(source.id);
    try {
      const result = await clientApi<{ runs: ImportRunSummary[] }>(`/api/import-sources/${source.id}/runs`, { cache: "no-store" });
      setRuns({ source, items: result.runs });
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Läufe konnten nicht geladen werden."); }
    finally { setBusy(null); }
  }

  async function resolveProposal(proposal: ImportProposalSummary, accept: boolean, episodeId?: string) {
    setBusy(proposal.id); setMessage("");
    try {
      await clientApi(`/api/import-proposals/${proposal.id}/${accept ? "accept" : "reject"}`, {
        method: "POST", body: accept ? JSON.stringify({ episodeId: episodeId || undefined }) : undefined,
      });
      setProposals((current) => current.filter((item) => item.id !== proposal.id));
      setMessage(accept ? "Änderung übernommen." : "Änderung verworfen.");
      await reload(); router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Vorschlag konnte nicht bearbeitet werden."); }
    finally { setBusy(null); }
  }

  return (
    <Card className="online-sources-card">
      <div className="row space-between source-heading"><div><p className="eyebrow">Automatischer Katalog</p><h2>Online-Quellen</h2><p className="muted">Offizielle Kataloge oder öffentliche Feeds werden täglich sicher geprüft.</p></div><Button onClick={() => setShowWizard(true)}><CloudDownload size={17} />Quelle hinzufügen</Button></div>
      {message && <p className={/fehl|nicht|auffällig/i.test(message) ? "form-error" : "form-success"} role="status">{message}</p>}
      <div className="source-list">
        {sources.map((source) => (
          <article className="source-row" key={source.id}>
            <span className={`source-state ${source.enabled ? "online" : "paused"}`}><CloudDownload size={18} /></span>
            <div className="grow"><div className="row-wrap"><strong>{source.name}</strong><Badge tone={source.enabled ? "good" : "neutral"}>{source.enabled ? "Aktiv" : source.confirmed ? "Pausiert" : "Einrichtung offen"}</Badge>{source.pendingProposalCount > 0 && <Badge tone="warn">{source.pendingProposalCount} offen</Badge>}</div><small>{kindLabels[source.kind]} · {source.seriesName}</small><small>{source.lastSuccessAt ? `Zuletzt erfolgreich: ${formatDateTime(source.lastSuccessAt)}` : "Noch kein abgeschlossener Lauf"}{source.lastItemCount != null ? ` · ${source.lastItemCount} Einträge` : ""}</small>{source.lastError && <span className="source-error"><AlertTriangle size={13} />{source.lastError}</span>}</div>
            <div className="row-wrap source-actions">
              {source.confirmed ? <Button size="sm" variant="secondary" disabled={busy === source.id} onClick={() => sync(source.id)}><RefreshCw size={14} />Jetzt prüfen</Button> : <Button size="sm" variant="secondary" disabled={busy === source.id} onClick={() => previewExisting(source.id)}><Play size={14} />Vorschau</Button>}
              <Button size="sm" variant="ghost" onClick={() => showRuns(source)} disabled={busy === source.id}><History size={14} />Läufe</Button>
              {source.confirmed && <Button size="sm" variant="ghost" onClick={() => toggle(source)} disabled={busy === source.id}>{source.enabled ? <Pause size={14} /> : <Play size={14} />}{source.enabled ? "Pausieren" : "Aktivieren"}</Button>}
              <Button size="sm" variant="ghost" onClick={() => remove(source)} disabled={busy === source.id} aria-label="Quelle deaktivieren"><Trash2 size={14} /></Button>
            </div>
          </article>
        ))}
        {!sources.length && <div className="empty-state source-empty"><CloudDownload size={30} /><h3>Noch keine Online-Quelle</h3><p className="muted">Der erste Abruf wird immer nur als Vorschau angezeigt.</p></div>}
      </div>

      {proposals.length > 0 && <div className="proposal-section"><div><p className="eyebrow">Manuelle Prüfung</p><h3>Offene Änderungen</h3></div>{proposals.map((proposal) => <ProposalRow key={proposal.id} proposal={proposal} source={sourceById.get(proposal.sourceId)} episodes={episodes} busy={busy === proposal.id} onResolve={resolveProposal} />)}</div>}

      {showWizard && <SourceWizard series={series} busy={busy === "create"} message={message} onSubmit={createAndPreview} onClose={() => setShowWizard(false)} />}
      {preview && <PreviewDialog preview={preview} resolutions={resolutions} episodes={episodes} source={sourceById.get(preview.run.sourceId)} busy={busy === "commit"} onChange={(id, value) => setResolutions((current) => ({ ...current, [id]: value }))} onCommit={commitPreview} onClose={() => setPreview(null)} />}
      {runs && <RunsDialog data={runs} onClose={() => setRuns(null)} />}
    </Card>
  );
}

function SourceWizard({ series, busy, message, onSubmit, onClose }: { series: SeriesOverview[]; busy: boolean; message: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const [kind, setKind] = useState<ImportSourceKind>("drei_fragezeichen");
  const [seriesId, setSeriesId] = useState(series.find((item) => !item.archived)?.id || "new");
  const defaults = kind === "drei_fragezeichen" ? "Die drei ??? – offiziell" : kind === "tkkg" ? "TKKG – offiziell" : `Mein ${kind.toUpperCase()}-Feed`;
  const custom = ["csv", "json", "rss"].includes(kind);
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="source-wizard-title"><div className="modal-header"><div><p className="eyebrow">Einrichtungsassistent</p><h2 id="source-wizard-title">Online-Quelle hinzufügen</h2></div><Button variant="ghost" onClick={onClose}><X size={20} /></Button></div><form className="stack" onSubmit={onSubmit}><label>Quellentyp<select name="kind" value={kind} onChange={(event) => setKind(event.target.value as ImportSourceKind)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Anzeigename<input name="name" key={defaults} defaultValue={defaults} required /></label>{custom && <label>Öffentliche HTTPS-URL<input name="url" type="url" required pattern="https://.*" placeholder="https://example.org/episodes.json" /></label>}<label>Zielserie<select name="seriesId" value={seriesId} onChange={(event) => setSeriesId(event.target.value)}>{series.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="new">Neue Serie anlegen…</option></select></label>{seriesId === "new" && <div className="form-grid"><label>Name der Serie<input name="newSeriesName" required /></label><label>Stabiler Schlüssel<input name="newSeriesKey" required pattern="[a-z0-9][a-z0-9_-]*" placeholder="meine-serie" /></label><label>Akzentfarbe<input name="accentColor" type="color" defaultValue="#f0a35b" /></label></div>}<p className="muted">Der erste Abruf legt noch nichts an. Du bestätigst jeden Treffer in der nächsten Vorschau.</p>{message && <p className="form-error">{message}</p>}<div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button><Button type="submit" disabled={busy}>{busy ? "Quelle wird geprüft…" : "Vorschau laden"}</Button></div></form></section></div>;
}

function PreviewDialog({ preview, resolutions, episodes, source, busy, onChange, onCommit, onClose }: { preview: ImportPreviewResult; resolutions: Record<string, Resolution>; episodes: EpisodeSummary[]; source?: ImportSourceSummary; busy: boolean; onChange: (id: string, value: Resolution) => void; onCommit: () => void; onClose: () => void }) {
  const targetEpisodes = episodes.filter((episode) => !source || episode.seriesId === source.seriesId);
  const ready = preview.run.status === "awaiting_confirmation" && preview.proposals.every((proposal) => {
    const resolution = resolutions[proposal.id]; return resolution && (resolution.action !== "link" || Boolean(resolution.episodeId));
  });
  return <div className="modal-backdrop"><section className="modal modal-wide modal-frame" role="dialog" aria-modal="true" aria-labelledby="preview-title"><div className="modal-header"><div><p className="eyebrow">Erstimport</p><h2 id="preview-title">{preview.run.fetchedItemCount} Einträge prüfen</h2></div><Button variant="ghost" onClick={onClose}><X size={20} /></Button></div><div className="modal-scroll-body">{preview.run.status === "needs_review" && <p className="form-error"><AlertTriangle size={15} />{preview.run.errorMessage || "Die Quelle muss korrigiert und erneut geprüft werden."}</p>}{preview.warnings.length > 0 && <div className="import-result"><strong>{preview.warnings.length} Hinweise</strong><ul>{preview.warnings.slice(0, 10).map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}<div className="preview-list">{preview.proposals.map((proposal) => { const resolution = resolutions[proposal.id] || { action: "create" as const }; return <article className="preview-row" key={proposal.id}><div className="grow"><strong>{proposal.episode.numberLabel ? `${proposal.episode.numberLabel} · ` : "Sonderfolge · "}{proposal.episode.title}</strong><small>{proposal.episode.releaseDate || "Kein Datum"} · {proposal.episode.links.length} Links</small>{proposal.candidateTitle && <span className="match-hint"><Link2 size={13} />Vorschlag: {proposal.candidateTitle}</span>}</div><select aria-label={`Aktion für ${proposal.episode.title}`} value={resolution.action} onChange={(event) => onChange(proposal.id, { action: event.target.value as Resolution["action"], episodeId: resolution.episodeId })}><option value="create">Neu anlegen</option><option value="link">Vorhandene Folge verknüpfen</option><option value="ignore">Ignorieren</option></select>{resolution.action === "link" && <select aria-label={`Zielfolge für ${proposal.episode.title}`} value={resolution.episodeId || ""} onChange={(event) => onChange(proposal.id, { action: "link", episodeId: event.target.value })}><option value="">Folge wählen…</option>{targetEpisodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.numberLabel ? `${episode.numberLabel} · ` : ""}{episode.title}</option>)}</select>}</article>; })}</div></div><div className="modal-actions"><Button variant="ghost" onClick={onClose}>Später</Button><Button onClick={onCommit} disabled={!ready || busy}>{busy ? "Wird übernommen…" : "Entscheidungen bestätigen"}</Button></div></section></div>;
}

function ProposalRow({ proposal, source, episodes, busy, onResolve }: { proposal: ImportProposalSummary; source?: ImportSourceSummary; episodes: EpisodeSummary[]; busy: boolean; onResolve: (proposal: ImportProposalSummary, accept: boolean, episodeId?: string) => void }) {
  const [episodeId, setEpisodeId] = useState(proposal.candidateEpisodeId || "");
  const link = proposal.proposalType === "link";
  return <article className="proposal-row"><div className="grow"><div className="row-wrap"><Badge tone="warn">{proposal.proposalType === "update" ? "Metadaten geändert" : proposal.proposalType === "link" ? "Möglicher Treffer" : "Neue Folge"}</Badge><strong>{proposal.episode.title}</strong></div><small>{source?.name || "Quelle"}{proposal.episode.numberLabel ? ` · Folge ${proposal.episode.numberLabel}` : " · Sonderfolge"}</small>{Object.keys(proposal.fieldChanges).length > 0 && <small>{Object.keys(proposal.fieldChanges).join(", ")}</small>}</div>{link && <select value={episodeId} onChange={(event) => setEpisodeId(event.target.value)}><option value="">Folge wählen…</option>{episodes.filter((episode) => !source || episode.seriesId === source.seriesId).map((episode) => <option key={episode.id} value={episode.id}>{episode.numberLabel ? `${episode.numberLabel} · ` : ""}{episode.title}</option>)}</select>}<Button size="sm" onClick={() => onResolve(proposal, true, episodeId)} disabled={busy || link && !episodeId}><Check size={14} />Annehmen</Button><Button size="sm" variant="ghost" onClick={() => onResolve(proposal, false)} disabled={busy}><X size={14} />Ablehnen</Button></article>;
}

function RunsDialog({ data, onClose }: { data: { source: ImportSourceSummary; items: ImportRunSummary[] }; onClose: () => void }) {
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="runs-title"><div className="modal-header"><div><p className="eyebrow">Laufhistorie</p><h2 id="runs-title">{data.source.name}</h2></div><Button variant="ghost" onClick={onClose}><X size={20} /></Button></div><div className="run-list">{data.items.map((run) => <article className="run-row" key={run.id}><Badge tone={run.status === "succeeded" || run.status === "not_modified" ? "good" : run.status === "failed" || run.status === "needs_review" ? "warn" : "neutral"}>{statusLabels[run.status]}</Badge><span className="grow"><strong>{formatDateTime(run.startedAt)}</strong><small>{run.fetchedItemCount} gelesen · {run.newItemCount} neu · {run.changedItemCount} geändert</small>{run.errorMessage && <small className="source-error">{run.errorMessage}</small>}</span></article>)}{!data.items.length && <p className="muted">Noch keine Läufe.</p>}</div></section></div>;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
