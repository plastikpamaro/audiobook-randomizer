import type { PlaybackProgress, PlaybackSave } from "@/lib/playback-types";

const SAVE_INTERVAL_MS = 5_000;

export function syncAudioPlayback(
  audio: HTMLAudioElement,
  endpoint: string,
  report: (error: string) => void,
): () => void {
  let disposed = false;
  let sessionId: string | null = null;
  let sequence = 0;
  let confirmedSequence = 0;
  let lastAttempt = 0;
  let claiming = false;
  let allowNextPlay = false;
  let restoring = false;
  let selectedPosition: number | null = null;
  let pendingSave: Promise<void> = Promise.resolve();
  let dirty = false;
  let reportedError = "";
  const loadController = new AbortController();

  function message(error = "") {
    if (disposed || reportedError === error) return;
    reportedError = error;
    report(error);
  }

  async function request(method: "GET" | "POST" | "PUT", body?: object) {
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      // Small saves can finish when navigating away or closing the player.
      keepalive: method === "PUT",
      signal: method === "GET"
        ? AbortSignal.any([loadController.signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { progress: PlaybackProgress; error?: string; code?: string };
    if (!response.ok) {
      const error = new Error(result.error || "Die Hörposition konnte nicht gespeichert werden.");
      Object.assign(error, { code: result.code });
      throw error;
    }
    return result.progress;
  }

  async function restore(position: number) {
    const target = Number.isFinite(audio.duration) && position >= audio.duration ? 0 : position;
    if (Math.abs(audio.currentTime - target) <= 0.01) return;
    restoring = true;
    // Setting currentTime starts an asynchronous seek. Do not play or save
    // until the browser has actually reached the restored position.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Die Hörposition konnte nicht wiederhergestellt werden.")), 10_000);
      function finish(error?: Error) {
        clearTimeout(timer);
        audio.removeEventListener("seeked", reached);
        loadController.signal.removeEventListener("abort", cancelled);
        restoring = false;
        if (error) reject(error); else resolve();
      }
      function reached() {
        finish(Math.abs(audio.currentTime - target) > 1 ? new Error("Die Hörposition konnte nicht wiederhergestellt werden.") : undefined);
      }
      function cancelled() { finish(new Error("Player geschlossen")); }
      audio.addEventListener("seeked", reached, { once: true });
      loadController.signal.addEventListener("abort", cancelled, { once: true });
      try { audio.currentTime = target; } catch { finish(new Error("Die Hörposition konnte nicht wiederhergestellt werden.")); }
    });
  }

  const metadata = audio.readyState >= 1 ? Promise.resolve() : new Promise<void>((resolve, reject) => {
    audio.addEventListener("loadedmetadata", () => resolve(), { once: true, signal: loadController.signal });
    audio.addEventListener("error", () => reject(new Error("Audio konnte nicht geladen werden")), { once: true, signal: loadController.signal });
  });
  const loaded = Promise.all([request("GET"), metadata]).then(async ([progress]) => {
    if (disposed) return;
    if (selectedPosition === null) await restore(progress.positionSeconds);
    message();
  }).catch(() => {
    message("Die Hörposition konnte nicht geladen werden. Mit Play erneut versuchen.");
  });

  function save(finished = audio.ended, allowSeeking = false): Promise<void> {
    if (!sessionId || restoring || (audio.seeking && !allowSeeking) || !Number.isFinite(audio.duration) || audio.duration <= 0) return pendingSave;
    const savingSession = sessionId;
    const input: PlaybackSave = {
      sessionId: savingSession,
      sequence: ++sequence,
      positionSeconds: finished ? 0 : Math.min(audio.currentTime, audio.duration),
      durationSeconds: audio.duration,
      finished,
    };
    lastAttempt = Date.now();
    dirty = true;
    pendingSave = request("PUT", input).then(() => {
      if (sessionId !== savingSession || input.sequence < confirmedSequence) return;
      confirmedSequence = input.sequence;
      if (input.sequence === sequence) dirty = false;
      message();
    }).catch((error: unknown) => {
      if (disposed || sessionId !== savingSession || input.sequence < confirmedSequence) return;
      if (error instanceof Error && "code" in error && error.code === "PLAYBACK_REPLACED") {
        sessionId = null;
        dirty = false;
        audio.pause();
        message(error.message);
      } else {
        message("Hörposition noch nicht gespeichert. Bitte prüfe deine Verbindung; das Speichern wird erneut versucht.");
      }
    });
    return pendingSave;
  }

  async function play() {
    if (allowNextPlay) { allowNextPlay = false; return; }
    if (claiming) { audio.pause(); return; }
    claiming = true;
    const previousSave = pendingSave;
    sessionId = null;
    audio.pause();
    try {
      await loaded;
      await previousSave;
      if (disposed) return;
      const nextSession = crypto.randomUUID();
      const progress = await request("POST", { sessionId: nextSession });
      if (disposed) return;
      sequence = 0;
      confirmedSequence = 0;
      dirty = false;
      sessionId = nextSession;
      await restore(selectedPosition ?? progress.positionSeconds);
      if (disposed) return;
      selectedPosition = null;
      message();
      allowNextPlay = true;
      await audio.play();
    } catch {
      sessionId = null;
      allowNextPlay = false;
      message("Weiterhören konnte nicht gestartet werden. Bitte prüfe deine Verbindung und drücke erneut Play.");
    } finally { claiming = false; }
  }

  function seeked() {
    if (restoring) { restoring = false; return; }
    if (!sessionId) { selectedPosition = audio.currentTime; return; }
    void save();
  }
  function periodicSave() {
    if ((!audio.paused || dirty) && Date.now() - lastAttempt >= SAVE_INTERVAL_MS) void save();
  }
  function pause() { if (!claiming) void save(audio.ended, true); }
  function ended() { void save(true); }
  function flush() { void save(audio.ended, true); }
  function visibility() { if (document.visibilityState === "hidden") flush(); }
  const onPlay = () => { void play(); };

  audio.addEventListener("play", onPlay);
  audio.addEventListener("pause", pause);
  audio.addEventListener("seeked", seeked);
  audio.addEventListener("ended", ended);
  audio.addEventListener("timeupdate", periodicSave);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", flush);
  window.addEventListener("online", flush);
  const timer = window.setInterval(periodicSave, SAVE_INTERVAL_MS);

  return () => {
    flush();
    disposed = true;
    loadController.abort();
    window.clearInterval(timer);
    audio.removeEventListener("play", onPlay);
    audio.removeEventListener("pause", pause);
    audio.removeEventListener("seeked", seeked);
    audio.removeEventListener("ended", ended);
    audio.removeEventListener("timeupdate", periodicSave);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("online", flush);
    audio.pause();
  };
}
