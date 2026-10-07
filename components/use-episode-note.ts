"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { EpisodeNoteEditor, EpisodeNoteEditorRegistry, type EpisodeNoteSnapshot, type NoteEpisode } from "@/lib/episode-note-editor";

const browserEditors = new EpisodeNoteEditorRegistry();

async function saveEpisodeNote(userId: string, episodeId: string, note: string): Promise<void> {
  const response = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/preference`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note, expectedUserId: userId }),
    keepalive: true,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "Die Notiz konnte nicht gespeichert werden.");
  }
}

export function useEpisodeNote({ userId, initialEpisode }: {
  userId: string;
  initialEpisode: NoteEpisode | null;
}) {
  const [{ editor, mountEpisode, mountVersion, getServerSnapshot }] = useState(() => {
    const options = { userId, initialEpisode, save: (episodeId: string, note: string) => saveEpisodeNote(userId, episodeId, note) };
    // Server renders always have an isolated editor and the exact initial note snapshot.
    const reused = typeof window !== "undefined" && browserEditors.has(userId);
    const editor = typeof window === "undefined" ? new EpisodeNoteEditor(options) : browserEditors.getOrCreate(options);
    const serverSnapshot: EpisodeNoteSnapshot = { note: initialEpisode?.note ?? "", dirty: false, saving: false, error: null };
    // Initial server props may predate the last save completed by a cached editor.
    // A fresh browser poll can reconcile clean notes after the reused editor mounts.
    return { editor, mountEpisode: initialEpisode, mountVersion: reused ? -1 : editor.getVersion(), getServerSnapshot: () => serverSnapshot };
  });
  const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot, getServerSnapshot);

  useLayoutEffect(() => {
    // The mounted draw may differ from the cached draw; retain any queued edits on either.
    editor.syncEpisode(mountEpisode, mountVersion);
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* Saving still works when storage is unavailable. */ }
    editor.restoreDrafts(storage);
    const flush = () => { void editor.saveNow(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      editor.stopTimers();
      flush();
    };
  }, [editor, mountEpisode, mountVersion]);

  return {
    ...snapshot,
    setNote: editor.setNote,
    saveNow: editor.saveNow,
    syncEpisode: editor.syncEpisode,
    getVersion: editor.getVersion,
  };
}
