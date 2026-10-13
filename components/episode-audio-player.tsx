"use client";

import { useState } from "react";
import type { EpisodeSummary } from "@/lib/types";

export function EpisodeAudioPlayer({ episode }: { episode: EpisodeSummary }) {
  const [failed, setFailed] = useState(false);
  if (!episode.audioUrl) return null;
  return (
    <div className="episode-audio-player">
      <p className="eyebrow">Originalfassung</p>
      <audio key={episode.audioUrl} controls preload="none" src={episode.audioUrl}
        aria-label={`Originalfassung: ${episode.title}`} onError={() => setFailed(true)} onLoadedMetadata={() => setFailed(false)}>
        Dein Browser unterstützt keine Audiowiedergabe.
      </audio>
      {failed && <p className="form-error" role="status">Die Originalfassung konnte nicht geladen werden. Bitte lade die Seite neu und prüfe deine Anmeldung.</p>}
    </div>
  );
}
