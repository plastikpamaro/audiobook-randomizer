"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Heart, RotateCcw, Search, SkipForward, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clientApi } from "@/components/client-api";
import type { HistoryItem } from "@/lib/types";

export function HistoryClient({ initialItems }: { initialItems: HistoryItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [items, setItems] = useState(initialItems);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("de");
    return items.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (favoritesOnly && !item.episode.favorite) return false;
      return !needle || `${item.episode.seriesName} ${item.episode.numberLabel || ""} ${item.episode.title}`.toLocaleLowerCase("de").includes(needle);
    });
  }, [favoritesOnly, items, search, status]);

  async function restore(id: string) {
    setBusyId(id); setMessage("");
    try {
      await clientApi(`/api/history/${id}/restore`, { method: "POST" });
      setItems((current) => current.map((item) => item.id === id ? {
        ...item, canRestore: false, correctedAt: new Date().toISOString(), ratingEditable: false,
      } : item));
      setMessage("Die Folge liegt wieder im aktuellen Beutel."); router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Korrektur fehlgeschlagen."); }
    finally { setBusyId(null); }
  }

  async function updateRating(id: string, score: number | null) {
    setBusyId(id); setMessage("");
    try {
      await clientApi(`/api/draws/${id}/rating`, { method: "PUT", body: JSON.stringify({ score }) });
      setItems((current) => current.map((item) => item.id === id ? { ...item, rating: score } : item));
      setMessage(score == null ? "Bewertung entfernt." : "Bewertung gespeichert.");
      router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Bewertung fehlgeschlagen."); }
    finally { setBusyId(null); }
  }

  return (
    <>
      <Card>
        <div className="toolbar">
          <label className="toolbar-search">Suche<span className="input-with-icon"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Titel, Nummer oder Serie" /></span></label>
          <label>Aktion<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Alles</option><option value="heard">Gehört</option><option value="skipped">Übersprungen</option></select></label>
          <label className="check-label"><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} /><Heart size={15} />Nur Favoriten</label>
        </div>
        {message && <p className="form-success" role="status">{message}</p>}
        <div className="history-list">
          {filtered.map((item) => (
            <article className={`history-row ${item.correctedAt ? "history-corrected" : ""}`} key={item.id}>
              <span className={`history-icon ${item.status === "heard" ? "heard" : "skipped"}`}>{item.status === "heard" ? <Check size={18} /> : <SkipForward size={18} />}</span>
              <div className="grow history-copy">
                <div className="row-wrap"><strong>{item.episode.numberLabel ? `${item.episode.numberLabel} · ` : ""}{item.episode.title}</strong>{item.episode.favorite && <Heart size={13} fill="currentColor" />}{item.sourceType === "bulk" && <Badge>Bulk</Badge>}{item.correctedAt && <Badge>Korrigiert</Badge>}</div>
                <small>{item.episode.seriesName} · {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.resolvedAt || item.drawnAt))}</small>
                {item.episode.note && <p>{item.episode.note}</p>}
              </div>
              <div className="history-status"><Badge tone={item.status === "heard" ? "good" : "warn"}>{item.status === "heard" ? "Gehört" : "Übersprungen"}</Badge>{item.ratingEditable ? <label className="history-rating"><Star size={13} /><span className="sr-only">Bewertung</span><select value={item.rating ?? ""} onChange={(event) => void updateRating(item.id, event.target.value ? Number(event.target.value) : null)} disabled={busyId === item.id}><option value="">– / 10</option>{Array.from({ length: 10 }, (_, index) => index + 1).map((score) => <option key={score} value={score}>{score} / 10</option>)}</select></label> : item.rating != null ? <Badge tone="accent"><Star size={12} fill="currentColor" />{item.rating}/10</Badge> : null}{item.canRestore && <Button size="sm" variant="ghost" onClick={() => restore(item.id)} disabled={busyId === item.id}><RotateCcw size={14} />Zurückholen</Button>}</div>
            </article>
          ))}
          {!filtered.length && <div className="empty-state"><Search size={32} /><h3>Noch nichts Passendes im Verlauf</h3><p className="muted">Gehörte und übersprungene Ziehungen erscheinen hier.</p></div>}
        </div>
      </Card>
    </>
  );
}
