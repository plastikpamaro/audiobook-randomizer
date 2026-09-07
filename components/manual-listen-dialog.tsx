"use client";

import { useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientApi } from "@/components/client-api";
import type { EpisodeSummary } from "@/lib/types";

export function ManualListenDialog({ episode, onSaved, onClose }: { episode: EpisodeSummary; onSaved: () => void; onClose: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [rating, setRating] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await clientApi("/api/listens/manual", { method: "POST", body: JSON.stringify({ episodeId: episode.id, requestId, rating: rating ? Number(rating) : null }) });
      onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Der Hördurchlauf konnte nicht gespeichert werden."); setBusy(false); }
  }
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="manual-listen-title">
    <div className="modal-header"><div><p className="eyebrow">Deine Wahl</p><h2 id="manual-listen-title">Gezielt hören</h2></div><Button variant="ghost" disabled={busy} onClick={onClose} aria-label="Schließen"><X size={20}/></Button></div>
    <form className="stack" onSubmit={save}>
      <div><strong>{episode.numberLabel ? `${episode.numberLabel} · ` : ""}{episode.title}</strong><p className="muted">{episode.seriesName}{episode.durationMinutes ? ` · ${episode.durationMinutes} Minuten` : ""}</p></div>
      <div className="row-wrap">{episode.links.map((link) => <a key={link.id} className="button button-secondary button-sm" href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}<a className="button button-ghost button-sm" href={`https://www.google.com/search?q=${encodeURIComponent(`${episode.seriesName} ${episode.numberLabel || ""} ${episode.title} hören`)}`} target="_blank" rel="noreferrer">Hörfolge suchen</a></div>
      <p>{episode.status === "heard" ? "Schon in dieser Runde gehört: Erneutes Hören zählt als weiterer Hördurchlauf in deiner Statistik." : "Nach dem Speichern zählt die Folge in deiner Statistik und ist für diese Runde gehört."}</p>
      <p className="muted">Speichere, wenn du fertig gehört hast. Eine andere gezogene Folge bleibt offen.</p>
      <label>Bewertung (optional)<select value={rating} onChange={(event) => setRating(event.target.value)} disabled={busy}><option value="">Ohne Bewertung</option>{Array.from({ length: 10 }, (_, i) => <option key={i+1} value={i+1}>{i+1} / 10</option>)}</select></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Schließen</Button><Button type="submit" disabled={busy}><Check size={16}/>{busy ? "Wird gespeichert…" : "Als gehört speichern"}</Button></div>
    </form>
  </section></div>;
}
