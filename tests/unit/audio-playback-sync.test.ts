import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncAudioPlayback } from "@/components/audio-playback-sync";

class Audio extends EventTarget {
  readyState = 1;
  duration = 90;
  paused = true;
  ended = false;
  seeking = false;
  position = 0;
  get currentTime() { return this.position; }
  set currentTime(value: number) {
    this.position = value;
    queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  }
  async play() { this.paused = false; this.dispatchEvent(new Event("play")); }
  pause() {
    if (!this.paused) { this.paused = true; this.dispatchEvent(new Event("pause")); }
  }
}

describe("Hörposition im Player", () => {
  let audio: Audio;
  let pageWindow: EventTarget;
  let pageDocument: EventTarget & { visibilityState: string };
  let position: number;
  let owner: string | null;
  let failSaves: boolean;
  let requests: { method: string; body: Record<string, unknown> | null; keepalive?: boolean }[];
  let report = vi.fn<(error: string) => void>();
  let cleanup: (() => void) | undefined;
  const endpoint = "/api/episodes/test/playback";
  const settle = async () => { for (let index = 0; index < 50; index++) await Promise.resolve(); };

  beforeEach(() => {
    vi.useFakeTimers();
    audio = new Audio();
    position = 22;
    owner = null;
    failSaves = false;
    requests = [];
    report = vi.fn<(error: string) => void>();
    pageWindow = Object.assign(new EventTarget(), { setInterval, clearInterval });
    pageDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", pageWindow);
    vi.stubGlobal("document", pageDocument);
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      const body = options.body ? JSON.parse(String(options.body)) : null;
      const method = options.method!;
      requests.push({ method, body, keepalive: options.keepalive });
      if (method === "POST") owner = body.sessionId;
      if (method === "PUT") {
        if (body.sessionId !== owner) return Response.json({ code: "PLAYBACK_REPLACED", error: "Die Folge wird auf einem anderen Gerät weitergehört." }, { status: 409 });
        if (failSaves) throw new TypeError("Offline");
        position = body.finished ? 0 : body.positionSeconds;
      }
      return Response.json({ progress: { positionSeconds: position, durationSeconds: 90, updatedAt: null } });
    }));
  });
  afterEach(async () => {
    cleanup?.();
    cleanup = undefined;
    await settle();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  async function attach() {
    cleanup = syncAudioPlayback(audio as unknown as HTMLAudioElement, endpoint, report);
    await settle();
  }
  async function start() { await audio.play(); await settle(); }

  it("lädt ohne Autoplay und holt beim Play den neuesten Stand", async () => {
    await attach();
    expect(audio.currentTime).toBe(22);
    expect(audio.paused).toBe(true);
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
    position = 31;
    await start();
    expect(audio.currentTime).toBe(31);
    expect(audio.paused).toBe(false);
    expect(requests.map((request) => request.method)).toEqual(["GET", "POST"]);
  });

  it("speichert beim Pausieren, Zurückspulen und Verlassen mit aufsteigenden Sequenzen", async () => {
    await attach(); await start();
    audio.position = 35;
    audio.pause(); await settle();
    expect(position).toBe(35);
    audio.currentTime = 12; await settle();
    expect(position).toBe(12);
    audio.position = 13;
    pageWindow.dispatchEvent(new Event("pagehide")); await settle();
    expect(position).toBe(13);
    const saves = requests.filter((request) => request.method === "PUT");
    expect(saves.map((request) => request.body?.sequence)).toEqual([1, 2, 3]);
    expect(saves.every((request) => request.keepalive)).toBe(true);
  });

  it("speichert alle fünf Sekunden und versucht einen fehlgeschlagenen Pause-Save erneut", async () => {
    await attach(); await start();
    audio.position = 28;
    await vi.advanceTimersByTimeAsync(5000);
    expect(position).toBe(28);
    failSaves = true;
    audio.position = 29; audio.pause(); await settle();
    expect(position).toBe(28);
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining("noch nicht gespeichert"));
    failSaves = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(position).toBe(29);
    expect(report).toHaveBeenLastCalledWith("");
  });

  it("pausiert einen verdrängten Player und übernimmt beim nächsten Play den neuen Stand", async () => {
    await attach(); await start();
    owner = "other-device";
    position = 40;
    audio.position = 23;
    await vi.advanceTimersByTimeAsync(5000);
    expect(audio.paused).toBe(true);
    expect(position).toBe(40);
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining("anderen Gerät"));
    await start();
    expect(audio.currentTime).toBe(40);
    expect(audio.paused).toBe(false);
  });

  it("setzt erst beim Ende zurück und speichert beim Schließen auch einen laufenden Seek", async () => {
    await attach(); await start();
    audio.position = 90;
    audio.ended = true;
    audio.dispatchEvent(new Event("ended")); await settle();
    expect(position).toBe(0);
    audio.ended = false;
    audio.position = 10;
    audio.seeking = true;
    cleanup!(); cleanup = undefined; await settle();
    expect(position).toBe(10);
    expect(audio.paused).toBe(true);
  });

  it("startet nach dem Schließen nicht durch eine verspätete Übernahme-Antwort", async () => {
    await attach();
    let finishClaim: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finishClaim = resolve; }));
    await audio.play(); await settle();
    cleanup!(); cleanup = undefined;
    finishClaim(Response.json({ progress: { positionSeconds: 50, durationSeconds: 90, updatedAt: null } }));
    await settle();
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(22);
  });

  it("speichert regelmäßig ohne Statusupdates oder erneutes Positionieren des Players", async () => {
    await attach(); await start();
    const seek = vi.spyOn(audio, "currentTime", "set");
    for (const value of [26, 31, 36]) {
      audio.position = value;
      await vi.advanceTimersByTimeAsync(5000);
      expect(position).toBe(value);
    }
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(3);
    expect(report).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();
    expect(audio.paused).toBe(false);
  });
});
