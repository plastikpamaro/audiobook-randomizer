import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeNoteEditor, EpisodeNoteEditorRegistry } from "@/lib/episode-note-editor";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  };
}

function makeEditor(save = vi.fn<(id: string, note: string) => Promise<void>>().mockResolvedValue(undefined), userId = "user-a") {
  return new EpisodeNoteEditor({ userId, initialEpisode: { id: "episode-a", note: "Original" }, save });
}

afterEach(() => vi.useRealTimers());

describe("EpisodeNoteEditor", () => {
  it("debounces edits and ignores background notes while the text is dirty", async () => {
    vi.useFakeTimers();
    const save = vi.fn<(id: string, note: string) => Promise<void>>().mockResolvedValue(undefined);
    const editor = makeEditor(save);
    editor.setNote("Erste Änderung");
    await vi.advanceTimersByTimeAsync(500);
    editor.setNote("Neueste Änderung");
    editor.syncEpisode({ id: "episode-a", note: "Vom Hintergrund" });
    expect(editor.getSnapshot().note).toBe("Neueste Änderung");
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith("episode-a", "Neueste Änderung");
    expect(editor.getSnapshot()).toMatchObject({ dirty: false, saving: false, error: null });
  });

  it("serializes saves and flushes edits typed during an in-flight save", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    const save = vi.fn<(id: string, note: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const editor = makeEditor(save);
    editor.setNote("Erste Änderung");
    const flush = editor.saveNow();
    await Promise.resolve();
    editor.setNote("Neueste Änderung");
    editor.syncEpisode({ id: "episode-a", note: "Original" });
    const manualFlush = editor.saveNow();
    expect(save.mock.calls).toEqual([["episode-a", "Erste Änderung"]]);
    first.resolve();
    await Promise.resolve();
    expect(save.mock.calls).toEqual([["episode-a", "Erste Änderung"], ["episode-a", "Neueste Änderung"]]);
    expect(editor.getSnapshot()).toMatchObject({ note: "Neueste Änderung", dirty: true, saving: true });
    second.resolve();
    await expect(flush).resolves.toBe(true);
    await expect(manualFlush).resolves.toBe(true);
    expect(editor.getSnapshot()).toMatchObject({ note: "Neueste Änderung", dirty: false, saving: false });
  });

  it("persists a revert typed while a different value is being saved", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const save = vi.fn<(id: string, note: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise).mockResolvedValueOnce();
    const editor = makeEditor(save);
    editor.setNote("Änderung");
    const flush = editor.saveNow();
    await Promise.resolve();
    editor.setNote("Original");
    first.resolve();
    await expect(flush).resolves.toBe(true);
    expect(save.mock.calls).toEqual([["episode-a", "Änderung"], ["episode-a", "Original"]]);
    expect(editor.getSnapshot().note).toBe("Original");
  });

  it("resaves a reverted draft after reload when an older write was still pending", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const oldRequest = deferred();
    const oldEditor = makeEditor(vi.fn<(id: string, note: string) => Promise<void>>().mockReturnValue(oldRequest.promise));
    oldEditor.restoreDrafts(storage);
    oldEditor.setNote("Änderung vor dem Reload");
    void oldEditor.saveNow();
    await Promise.resolve();
    oldEditor.setNote("Original");
    oldEditor.stopTimers();

    // The old document has gone away; its keepalive write may reach the server
    // without the old controller being able to enqueue the user's revert.
    const saveAfterReload = vi.fn<(id: string, note: string) => Promise<void>>().mockResolvedValue(undefined);
    const restored = makeEditor(saveAfterReload);
    restored.restoreDrafts(storage);
    expect(restored.getSnapshot()).toMatchObject({ note: "Original", dirty: true });
    restored.syncEpisode({ id: "episode-a", note: "Änderung vor dem Reload" }, restored.getVersion());
    expect(restored.getSnapshot()).toMatchObject({ note: "Original", dirty: true });
    await vi.advanceTimersByTimeAsync(800);
    expect(saveAfterReload).toHaveBeenCalledExactlyOnceWith("episode-a", "Original");
    expect(restored.getSnapshot()).toMatchObject({ dirty: false, saving: false });
    expect(storage.length).toBe(0);
  });

  it("rejects a stale refresh that started before a completed save", async () => {
    vi.useFakeTimers();
    const editor = makeEditor();
    const version = editor.getVersion();
    editor.setNote("Gespeichert");
    await editor.saveNow();
    editor.syncEpisode({ id: "episode-a", note: "Original" }, version);
    expect(editor.getSnapshot().note).toBe("Gespeichert");
    editor.syncEpisode({ id: "episode-a", note: "Auf einem anderen Gerät geändert" }, editor.getVersion());
    expect(editor.getSnapshot().note).toBe("Auf einem anderen Gerät geändert");
  });

  it("flushes the outgoing episode and keeps its failure visible after a remote switch", async () => {
    vi.useFakeTimers();
    const request = deferred();
    const save = vi.fn<(id: string, note: string) => Promise<void>>().mockReturnValueOnce(request.promise).mockResolvedValueOnce();
    const editor = makeEditor(save);
    editor.setNote("Entwurf Folge A");
    editor.syncEpisode({ id: "episode-b", note: "Folge B" });
    await Promise.resolve();
    expect(editor.getSnapshot().note).toBe("Folge B");
    expect(save).toHaveBeenCalledExactlyOnceWith("episode-a", "Entwurf Folge A");
    request.reject(new Error("Verbindung unterbrochen"));
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.getSnapshot().error).toBe("Notiz zur vorherigen Folge: Verbindung unterbrochen");
    await expect(editor.saveNow()).resolves.toBe(true);
    expect(editor.getSnapshot().error).toBeNull();
    editor.syncEpisode({ id: "episode-a", note: "Entwurf Folge A" });
    expect(editor.getSnapshot().note).toBe("Entwurf Folge A");
  });

  it("retains failed edits in account-scoped browser drafts and supports manual retry", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const save = vi.fn<(id: string, note: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Speichern fehlgeschlagen")).mockResolvedValueOnce();
    const editor = makeEditor(save);
    editor.restoreDrafts(storage);
    editor.setNote("Ungespeicherter Entwurf");
    await expect(editor.saveNow()).resolves.toBe(false);
    expect(editor.getSnapshot()).toMatchObject({ note: "Ungespeicherter Entwurf", dirty: true, error: "Speichern fehlgeschlagen" });
    expect(storage.length).toBe(1);
    const otherAccount = makeEditor(undefined, "user-b");
    otherAccount.restoreDrafts(storage);
    expect(otherAccount.getSnapshot().note).toBe("Original");
    const restored = makeEditor();
    restored.restoreDrafts(storage);
    expect(restored.getSnapshot().note).toBe("Ungespeicherter Entwurf");
    restored.stopTimers();
    await expect(editor.saveNow()).resolves.toBe(true);
    expect(editor.getSnapshot()).toMatchObject({ dirty: false, error: null });
    expect(storage.length).toBe(0);
  });

  it("removes a locally reverted draft instead of resurrecting it after reload", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const editor = makeEditor();
    editor.restoreDrafts(storage);
    editor.setNote("Verworfen");
    editor.setNote("Original");
    expect(storage.length).toBe(0);
    const restored = makeEditor();
    restored.restoreDrafts(storage);
    expect(restored.getSnapshot().note).toBe("Original");
  });

  it("does not block the active draw on a failed or still pending historical draft", async () => {
    vi.useFakeTimers();
    const historical = deferred();
    const save = vi.fn<(id: string, note: string) => Promise<void>>()
      .mockReturnValueOnce(historical.promise).mockResolvedValueOnce().mockRejectedValueOnce(new Error("Folge nicht gefunden"));
    const editor = makeEditor(save);
    editor.setNote("Entwurf einer gelöschten Folge");
    editor.syncEpisode({ id: "episode-b", note: "Original B" });
    editor.setNote("Aktuelle Notiz");
    await expect(editor.saveNow()).resolves.toBe(true);
    expect(save.mock.calls).toEqual([["episode-a", "Entwurf einer gelöschten Folge"], ["episode-b", "Aktuelle Notiz"]]);
    expect(editor.getSnapshot().note).toBe("Aktuelle Notiz");
    historical.reject(new Error("Folge nicht gefunden"));
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.getSnapshot().error).toBe("Notiz zur vorherigen Folge: Folge nicht gefunden");
    await expect(editor.saveNow()).resolves.toBe(true);
    await Promise.resolve();
    expect(editor.getSnapshot().error).toBe("Notiz zur vorherigen Folge: Folge nicht gefunden");
  });

  it("restores and saves an outgoing draft even if the active draw has changed", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const editor = makeEditor();
    editor.restoreDrafts(storage);
    editor.setNote("Zur vorherigen Folge");
    editor.stopTimers();
    const save = vi.fn<(id: string, note: string) => Promise<void>>().mockResolvedValue(undefined);
    const restored = new EpisodeNoteEditor({ userId: "user-a", initialEpisode: { id: "episode-b", note: "Jetzt B" }, save });
    restored.restoreDrafts(storage);
    expect(restored.getSnapshot().note).toBe("Jetzt B");
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledExactlyOnceWith("episode-a", "Zur vorherigen Folge");
    expect(storage.length).toBe(0);
  });

  it("retains one serialized write queue across browser remounts for the same account", async () => {
    vi.useFakeTimers();
    const registry = new EpisodeNoteEditorRegistry();
    const firstRequest = deferred();
    const latestRequest = deferred();
    const save = vi.fn<(id: string, note: string) => Promise<void>>()
      .mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(latestRequest.promise);
    const options = { userId: "user-a", initialEpisode: { id: "episode-a", note: "Original" }, save };
    const firstMount = registry.getOrCreate(options);
    firstMount.setNote("Erster Save");
    const firstFlush = firstMount.saveNow();
    await Promise.resolve();
    firstMount.setNote("Entwurf vor Navigation");
    firstMount.stopTimers();
    void firstMount.saveNow();
    const remount = registry.getOrCreate(options);
    expect(remount).toBe(firstMount);
    remount.syncEpisode(options.initialEpisode, remount.getVersion());
    remount.setNote("Neuester Text nach Navigation");
    const remountFlush = remount.saveNow();
    expect(save.mock.calls).toEqual([["episode-a", "Erster Save"]]);
    firstRequest.resolve();
    await Promise.resolve();
    expect(save.mock.calls).toEqual([["episode-a", "Erster Save"], ["episode-a", "Neuester Text nach Navigation"]]);
    latestRequest.resolve();
    await expect(firstFlush).resolves.toBe(true);
    await expect(remountFlush).resolves.toBe(true);
    expect(remount.getSnapshot()).toMatchObject({ note: "Neuester Text nach Navigation", dirty: false, saving: false });
    expect(registry.getOrCreate({ ...options, userId: "user-b" })).not.toBe(firstMount);
    expect(registry.getOrCreate({ ...options, userId: "user-b" }).getSnapshot().note).toBe("Original");
  });

  it("works without randomUUID on an insecure browser origin", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(() => makeEditor()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a completed cached note when the remount's SSR props predate that save", async () => {
    vi.useFakeTimers();
    const registry = new EpisodeNoteEditorRegistry();
    const options = { userId: "user-a", initialEpisode: { id: "episode-a", note: "Vor dem Serverrender" }, save: vi.fn<(id: string, note: string) => Promise<void>>().mockResolvedValue(undefined) };
    const editor = registry.getOrCreate(options);
    editor.setNote("Nach dem Serverrender gespeichert");
    await editor.saveNow();
    expect(registry.has(options.userId)).toBe(true);
    const remount = registry.getOrCreate(options);
    remount.syncEpisode(options.initialEpisode, -1);
    expect(remount.getSnapshot().note).toBe("Nach dem Serverrender gespeichert");
    remount.syncEpisode({ id: "episode-a", note: "Frischer Browserabgleich" }, remount.getVersion());
    expect(remount.getSnapshot().note).toBe("Frischer Browserabgleich");
  });
});
