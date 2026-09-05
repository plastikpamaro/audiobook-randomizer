"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check, ExternalLink, Heart, LoaderCircle, Plus, RotateCcw, Shuffle, SkipForward,
  Sparkles, Star, Trash2, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ActiveDraw, Preset, SeriesOverview } from "@/lib/types";

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || "Die Anfrage ist fehlgeschlagen.") as Error & { code?: string; details?: { seriesIds?: string[] } };
    error.code = payload.code;
    error.details = payload.details;
    throw error;
  }
  return payload;
}

export function DrawClient({
  initialSeries,
  initialPresets,
  initialDraw,
}: {
  initialSeries: SeriesOverview[];
  initialPresets: Preset[];
  initialDraw: ActiveDraw | null;
}) {
  const router = useRouter();
  const availableSeries = initialSeries.filter((item) => !item.archived);
  const [selected, setSelected] = useState<string[]>(availableSeries.map((item) => item.id));
  const [presets, setPresets] = useState(initialPresets);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [draw, setDraw] = useState(initialDraw);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [emptySeries, setEmptySeries] = useState<string[]>([]);
  const [presetName, setPresetName] = useState("");
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [note, setNote] = useState(initialDraw?.episode.note || "");
  const [ratingTarget, setRatingTarget] = useState<{ id: string; title: string; seriesName: string } | null>(null);
  const [ratingScore, setRatingScore] = useState<number | null>(null);

  const remaining = useMemo(
    () => availableSeries.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + item.remainingCount, 0),
    [availableSeries, selected],
  );
  const exhaustedSelected = useMemo(
    () => availableSeries
      .filter((item) => selected.includes(item.id) && item.totalCount > 0 && item.remainingCount === 0)
      .map((item) => item.id),
    [availableSeries, selected],
  );

  const refreshCurrent = useCallback(async () => {
    try {
      const result = await api<{ draw: ActiveDraw | null }>("/api/draw/current", { cache: "no-store" });
      setDraw(result.draw);
      setNote(result.draw?.episode.note || "");
    } catch {
      // Hintergrundabgleich darf die Hauptoberfläche nicht stören.
    }
  }, []);

  useEffect(() => {
    const onFocus = () => void refreshCurrent();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshCurrent();
    }, 15_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [refreshCurrent]);

  async function pick() {
    if (!selected.length) return;
    setBusy(true); setMessage(""); setEmptySeries([]);
    try {
      const result = await api<{ draw: ActiveDraw }>("/api/draw", {
        method: "POST",
        body: JSON.stringify(activePreset ? { presetId: activePreset } : { seriesIds: selected }),
      });
      setDraw(result.draw); setNote(result.draw.episode.note || "");
    } catch (caught) {
      const error = caught as Error & { code?: string; details?: { seriesIds?: string[] } };
      setMessage(error.message);
      if (error.code === "EMPTY_POOL") setEmptySeries(error.details?.seriesIds || selected);
    } finally { setBusy(false); }
  }

  async function resolve(outcome: "heard" | "skip") {
    if (!draw) return;
    setBusy(true); setMessage("");
    try {
      const result = await api<{ draw: ActiveDraw }>(`/api/draws/${draw.id}/${outcome}`, { method: "POST" });
      if (outcome === "heard" && result.draw.ratingEditable) {
        setRatingTarget({ id: draw.id, title: draw.episode.title, seriesName: draw.episode.seriesName });
        setRatingScore(null);
      }
      setDraw(null); setNote("");
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Aktion fehlgeschlagen.");
      await refreshCurrent();
    } finally { setBusy(false); }
  }

  async function saveRating() {
    if (!ratingTarget || ratingScore == null) return;
    setBusy(true); setMessage("");
    try {
      await api(`/api/draws/${ratingTarget.id}/rating`, { method: "PUT", body: JSON.stringify({ score: ratingScore }) });
      setRatingTarget(null); setMessage("Bewertung gespeichert."); router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Bewertung fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  async function updatePreference(input: { favorite?: boolean; note?: string }) {
    if (!draw) return;
    try {
      await api(`/api/episodes/${draw.episode.id}/preference`, { method: "PATCH", body: JSON.stringify(input) });
      setDraw({ ...draw, episode: { ...draw.episode, ...input } });
      if (input.note !== undefined) setMessage("Notiz gespeichert.");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Speichern fehlgeschlagen."); }
  }

  async function reset() {
    const seriesIds = (emptySeries.length ? emptySeries : exhaustedSelected)
      .filter((id) => availableSeries.some((item) => item.id === id && item.totalCount > 0 && item.remainingCount === 0));
    if (!seriesIds.length) return;
    setBusy(true); setMessage("");
    try {
      await api("/api/rounds/reset", { method: "POST", body: JSON.stringify({ seriesIds }) });
      setEmptySeries([]); setMessage("Neue Runde gestartet. Der Beutel ist wieder gefüllt."); router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Reset fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  async function savePreset() {
    if (!presetName.trim() || !selected.length) return;
    setBusy(true); setMessage("");
    try {
      const result = await api<{ id: string }>("/api/presets", {
        method: "POST", body: JSON.stringify({ name: presetName, seriesIds: selected }),
      });
      const next = { id: result.id, name: presetName.trim(), seriesIds: selected };
      setPresets([...presets, next].sort((a, b) => a.name.localeCompare(b.name, "de")));
      setActivePreset(result.id); setPresetName(""); setShowPresetForm(false); setMessage("Preset gespeichert.");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Preset konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  async function removePreset(id: string) {
    setBusy(true);
    try {
      await api(`/api/presets/${id}`, { method: "DELETE" });
      setPresets(presets.filter((item) => item.id !== id));
      if (activePreset === id) setActivePreset(null);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Preset konnte nicht gelöscht werden."); }
    finally { setBusy(false); }
  }

  function choosePreset(id: string) {
    if (!id) { setActivePreset(null); return; }
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    setSelected(preset.seriesIds); setActivePreset(id); setEmptySeries([]);
  }

  function toggleSeries(id: string) {
    setActivePreset(null); setEmptySeries([]);
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  if (draw) {
    const episode = draw.episode;
    return (
      <div className="draw-stage">
        <Card className="now-card" style={{ "--series-color": episode.accentColor } as React.CSSProperties}>
          <div className="now-topline">
            <div className="row-wrap">
              <Badge tone="accent">Aktive Folge</Badge>
              {draw.wasPriority && <Badge tone="warn"><Sparkles size={12} /> Neuerscheinung</Badge>}
              {episode.numberLabel ? <Badge>Folge {episode.numberLabel}</Badge> : <Badge>Sonderfolge</Badge>}
            </div>
            <Button variant="ghost" size="sm" onClick={() => updatePreference({ favorite: !episode.favorite })} aria-label={episode.favorite ? "Favorit entfernen" : "Als Favorit merken"}>
              <Heart size={19} fill={episode.favorite ? "currentColor" : "none"} />
            </Button>
          </div>
          <div className="series-rule" />
          <p className="now-series">{episode.seriesName}</p>
          <h1>{episode.title}</h1>
          <div className="episode-meta">
            {episode.durationMinutes && <span>{episode.durationMinutes} Min.</span>}
            {episode.releaseDate && <span>Erschienen {new Intl.DateTimeFormat("de-DE").format(new Date(`${episode.releaseDate}T12:00:00Z`))}</span>}
            <span>Runde {draw.roundNumber}</span>
          </div>
          {episode.links.length > 0 && (
            <div className="listen-links">
              {episode.links.map((link) => (
                <a key={link.id} className="button button-secondary button-md" href={link.url} target="_blank" rel="noreferrer noopener">
                  {link.label}<ExternalLink size={15} />
                </a>
              ))}
            </div>
          )}
          <label className="note-field">Private Notiz
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Was möchtest du dir zu dieser Folge merken?" maxLength={10_000} />
          </label>
          <div className="row-wrap now-actions">
            <Button size="lg" onClick={() => resolve("heard")} disabled={busy}><Check size={20} />Gehört</Button>
            <Button variant="secondary" size="lg" onClick={() => resolve("skip")} disabled={busy}><SkipForward size={20} />Überspringen</Button>
            <Button variant="ghost" onClick={() => updatePreference({ note })} disabled={busy}>Notiz speichern</Button>
          </div>
          {message && <p className={message.includes("gespeichert") ? "form-success" : "form-error"} role="status">{message}</p>}
        </Card>
        <p className="sync-note">Diese Folge bleibt auf allen Geräten aktiv, bis du sie abschließt oder überspringst.</p>
      </div>
    );
  }

  return (
    <>
    <div className="draw-grid">
      <Card className="picker-card card-accent">
        <div className="row space-between picker-heading">
          <div><p className="eyebrow">Deine Auswahl</p><h2>Was darf heute in den Beutel?</h2></div>
          <div className="remaining-pill"><strong>{remaining}</strong><span>übrig</span></div>
        </div>
        {presets.length > 0 && (
          <div className="preset-row">
            <select value={activePreset || ""} onChange={(event) => choosePreset(event.target.value)} aria-label="Gespeichertes Preset auswählen">
              <option value="">Freie Auswahl</option>
              {presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}
            </select>
            {activePreset && <Button variant="ghost" size="sm" onClick={() => removePreset(activePreset)} aria-label="Preset löschen"><Trash2 size={16} /></Button>}
          </div>
        )}
        <div className="series-picker">
          {availableSeries.length ? availableSeries.map((item) => {
            const checked = selected.includes(item.id);
            const total = Math.max(1, item.totalCount);
            return (
              <label key={item.id} className={`series-option ${checked ? "selected" : ""}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleSeries(item.id)} />
                <span className="series-dot" style={{ background: item.accentColor }} />
                <span className="grow"><strong>{item.name}</strong><small>{item.remainingCount} von {item.totalCount} verfügbar · Runde {item.roundNumber}</small><span className="mini-progress"><i style={{ width: `${(item.heardCount / total) * 100}%`, background: item.accentColor }} /></span></span>
              </label>
            );
          }) : (
            <div className="empty-state"><Shuffle size={34} /><h3>Noch ist der Beutel leer.</h3><p className="muted">Importiere Folgen oder lege in der Bibliothek deine erste Serie an.</p><a className="button button-secondary button-md" href="/bibliothek">Zur Bibliothek</a></div>
          )}
        </div>
        <div className="picker-footer">
          {remaining > 0 ? (
            <Button size="lg" className="draw-button" disabled={busy || !selected.length} onClick={pick}>
              {busy ? <LoaderCircle className="spin" size={22} /> : <Shuffle size={22} />}
              Zufällige Folge ziehen
            </Button>
          ) : exhaustedSelected.length > 0 ? (
            <Button size="lg" variant="secondary" className="draw-button" disabled={busy} onClick={reset}>
              <RotateCcw size={20} />Erschöpfte Serien neu starten
            </Button>
          ) : (
            <Button size="lg" className="draw-button" disabled><Shuffle size={22} />Keine veröffentlichte Folge verfügbar</Button>
          )}
          <Button variant="ghost" onClick={() => setShowPresetForm(!showPresetForm)} disabled={!selected.length}><Plus size={17} />Auswahl speichern</Button>
        </div>
        {showPresetForm && (
          <div className="inline-form"><input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Name, z. B. Detektivabend" maxLength={100} /><Button onClick={savePreset} disabled={busy || !presetName.trim()}>Speichern</Button></div>
        )}
        {message && <p className={emptySeries.length ? "form-error" : "form-success"} role="status">{message}</p>}
        {emptySeries.length > 0 && exhaustedSelected.length > 0 && <Button variant="secondary" onClick={reset} disabled={busy}><RotateCcw size={17} />Erschöpfte Serien neu starten</Button>}
      </Card>
      <aside className="draw-aside stack">
        <Card className="card-subtle"><p className="eyebrow">Ohne Dopplung</p><h3>Ein Beutel, alle Geräte.</h3><p className="muted">Gehörte Folgen verschwinden global aus ihrer aktuellen Runde – ganz gleich, über welches Preset du sie gefunden hast.</p></Card>
        <Card className="card-subtle"><p className="eyebrow">Neu schlägt alt</p><h3>Veröffentlichungen zuerst.</h3><p className="muted">Fällige Neuerscheinungen erhalten einmal Vorrang. Danach mischen sie sich fair unter alle übrigen Folgen.</p></Card>
      </aside>
    </div>
    {ratingTarget && (
      <div className="modal-backdrop">
        <section className="modal modal-small rating-dialog" role="dialog" aria-modal="true" aria-labelledby="rating-title">
          <div className="modal-header"><div><p className="eyebrow">Gerade gehört</p><h2 id="rating-title">Wie war die Folge?</h2></div><Button variant="ghost" onClick={() => setRatingTarget(null)} aria-label="Später bewerten"><X size={20} /></Button></div>
          <p><strong>{ratingTarget.title}</strong><br /><span className="muted">{ratingTarget.seriesName}</span></p>
          <div className="rating-scale" role="radiogroup" aria-label="Bewertung von 1 bis 10">
            {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
              <button key={score} type="button" className={ratingScore === score ? "selected" : ""} onClick={() => setRatingScore(score)} role="radio" aria-checked={ratingScore === score}>
                <Star size={15} fill={ratingScore === score ? "currentColor" : "none"} /><span>{score}</span>
              </button>
            ))}
          </div>
          <p className="muted rating-hint">1 bedeutet schwach, 10 bedeutet großartig. Die Bewertung verändert die Ziehung nicht.</p>
          {message && <p className="form-error">{message}</p>}
          <div className="modal-actions"><Button variant="ghost" onClick={() => setRatingTarget(null)}>Später</Button><Button onClick={saveRating} disabled={busy || ratingScore == null}>Bewertung speichern</Button></div>
        </section>
      </div>
    )}
    </>
  );
}
