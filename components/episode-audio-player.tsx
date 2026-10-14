"use client";

import { useEffect, useRef, useState } from "react";
import { syncAudioPlayback } from "@/components/audio-playback-sync";
import type { EpisodeSummary } from "@/lib/types";

export function EpisodeAudioPlayer({ episode }: { episode: EpisodeSummary }) {
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [sync, setSync] = useState({ message: "Hörposition wird geladen…", error: false });
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !episode.audioUrl) return;
    return syncAudioPlayback(audio, `/api/episodes/${episode.id}/playback`, (message, error) => setSync({ message, error }));
  }, [episode.id, episode.audioUrl]);
  if (!episode.audioUrl) return null;
  return (
    <div className="episode-audio-player">
      <p className="eyebrow">Originalfassung</p>
      <audio ref={audioRef} key={episode.audioUrl} controls preload="metadata" src={episode.audioUrl}
        aria-label={`Originalfassung: ${episode.title}`} onError={() => setFailed(true)} onLoadedMetadata={() => setFailed(false)}>
        Dein Browser unterstützt keine Audiowiedergabe.
      </audio>
      <p className={sync.error ? "form-error" : "muted"} role={sync.error ? "status" : undefined}>{sync.message}</p>
      {failed && <p className="form-error" role="status">Die Originalfassung konnte nicht geladen werden. Bitte lade die Seite neu und prüfe deine Anmeldung.</p>}
    </div>
  );
}
