export type NoteEpisode = { id: string; note?: string | null };

export type EpisodeNoteSnapshot = {
  note: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
};

type DraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
type NoteEntry = {
  id: string;
  note: string;
  savedNote: string;
  forceSave: boolean;
  error: string | null;
  pending: Promise<boolean> | null;
  timer: ReturnType<typeof setTimeout> | null;
};

type EditorOptions = {
  userId: string;
  initialEpisode: NoteEpisode | null;
  save: (episodeId: string, note: string) => Promise<void>;
  debounceMs?: number;
};

const LOCAL_DRAFT_ERROR = "Der Notizentwurf konnte im Browser nicht gesichert werden. Bitte die Notiz speichern, bevor du die Seite verlässt.";

/** Keeps user edits independent of refreshed episode data and serializes each episode's writes. */
export class EpisodeNoteEditor {
  private readonly entries = new Map<string, NoteEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly prefix: string;
  private readonly save: EditorOptions["save"];
  private readonly debounceMs: number;
  private readonly draftOwner = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private currentId: string | null;
  private version = 0;
  private storage: DraftStorage | null = null;
  private storageFailed = false;
  private snapshot: EpisodeNoteSnapshot;

  constructor({ userId, initialEpisode, save, debounceMs = 800 }: EditorOptions) {
    this.prefix = `audiobook-randomizer:note-draft:${encodeURIComponent(userId)}:`;
    this.currentId = initialEpisode?.id ?? null;
    this.save = save;
    this.debounceMs = debounceMs;
    if (initialEpisode) this.entries.set(initialEpisode.id, this.makeEntry(initialEpisode));
    this.snapshot = this.makeSnapshot();
  }

  private makeEntry(episode: NoteEpisode): NoteEntry {
    const note = episode.note ?? "";
    return { id: episode.id, note, savedNote: note, forceSave: false, error: null, pending: null, timer: null };
  }

  private makeSnapshot(): EpisodeNoteSnapshot {
    const current = this.currentId ? this.entries.get(this.currentId) : undefined;
    const failed = [...this.entries.values()].find((entry) => entry.error);
    const pendingChanges = [...this.entries.values()].some((entry) => entry.note !== entry.savedNote || entry.forceSave || entry.pending);
    return {
      note: current?.note ?? "",
      dirty: Boolean(current && (current.note !== current.savedNote || current.forceSave)),
      saving: [...this.entries.values()].some((entry) => entry.pending !== null),
      error: current?.error ?? (failed ? `Notiz zur vorherigen Folge: ${failed.error}` : null)
        ?? (this.storageFailed && pendingChanges ? LOCAL_DRAFT_ERROR : null),
    };
  }

  private publish() {
    this.snapshot = this.makeSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  getSnapshot = (): EpisodeNoteSnapshot => this.snapshot;
  getVersion = (): number => this.version;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private draftKey(id: string) {
    return `${this.prefix}${encodeURIComponent(id)}`;
  }

  private persist(entry: NoteEntry) {
    if (!this.storage) return;
    try {
      const key = this.draftKey(entry.id);
      if (entry.note === entry.savedNote && !entry.pending && !entry.forceSave) {
        // A different tab may already have written a newer draft into this slot.
        const previous = this.storage.getItem(key);
        if (previous) {
          const draft = JSON.parse(previous) as { note?: unknown; owner?: unknown };
          if (draft.owner === this.draftOwner || draft.note === entry.note) this.storage.removeItem(key);
        }
      } else {
        this.storage.setItem(key, JSON.stringify({ note: entry.note, savedNote: entry.savedNote, pending: entry.pending !== null || entry.forceSave, owner: this.draftOwner }));
      }
      this.storageFailed = false;
    } catch {
      this.storageFailed = true;
    }
  }

  /** Called after mount so SSR and hydration both start with the server's note. */
  restoreDrafts(storage: DraftStorage | null) {
    this.storage = storage;
    if (!storage) {
      this.storageFailed = true;
      this.publish();
      return;
    }
    try {
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter((key): key is string => key !== null && key.startsWith(this.prefix));
      for (const key of keys) {
        try {
          const id = decodeURIComponent(key.slice(this.prefix.length));
          const draft = JSON.parse(storage.getItem(key) ?? "null") as { note?: unknown; savedNote?: unknown; pending?: unknown } | null;
          if (!id || !draft || typeof draft.note !== "string" || typeof draft.savedNote !== "string"
            || draft.note.length > 10_000 || draft.savedNote.length > 10_000) continue;
          let entry = this.entries.get(id);
          if (entry && (entry.note !== entry.savedNote || entry.forceSave || entry.pending)) continue;
          if (!entry) {
            entry = this.makeEntry({ id, note: draft.savedNote });
            this.entries.set(id, entry);
          }
          entry.note = draft.note;
          // A terminated document cannot send its queued revert after an older
          // keepalive request completes. Resave the restored text even if it
          // currently matches the server's note.
          entry.forceSave = draft.pending === true;
          this.persist(entry);
          if (entry.note !== entry.savedNote || entry.forceSave) this.schedule(entry);
        } catch {
          // An invalid draft must not prevent restoring the other episode drafts.
        }
      }
      this.version++;
    } catch {
      this.storageFailed = true;
    }
    this.publish();
  }

  setNote = (note: string) => {
    const entry = this.currentId ? this.entries.get(this.currentId) : undefined;
    if (!entry || entry.note === note) return;
    entry.note = note;
    entry.error = null;
    this.version++;
    this.persist(entry);
    this.schedule(entry);
    this.publish();
  };

  /** Pass the version captured before a refresh to discard an older note response. */
  syncEpisode = (episode: NoteEpisode | null, requestVersion?: number) => {
    const previous = this.currentId ? this.entries.get(this.currentId) : undefined;
    const switched = this.currentId !== (episode?.id ?? null);
    if (switched && previous) void this.flushEntry(previous);
    const responseIsCurrent = requestVersion === undefined || requestVersion === this.version;
    this.currentId = episode?.id ?? null;
    if (episode) {
      const entry = this.entries.get(episode.id);
      if (!entry) {
        this.entries.set(episode.id, this.makeEntry(episode));
      } else if (entry.note === entry.savedNote && !entry.forceSave && !entry.pending && responseIsCurrent) {
        entry.note = episode.note ?? "";
        entry.savedNote = entry.note;
        entry.error = null;
      }
    }
    if (switched) this.version++;
    this.publish();
  };

  private clearTimer(entry: NoteEntry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
  }

  private schedule(entry: NoteEntry) {
    this.clearTimer(entry);
    if (entry.note === entry.savedNote && !entry.forceSave && !entry.pending) return;
    entry.timer = setTimeout(() => { void this.flushEntry(entry); }, this.debounceMs);
  }

  private flushEntry(entry: NoteEntry): Promise<boolean> {
    this.clearTimer(entry);
    if (entry.pending) return entry.pending;
    if (entry.note === entry.savedNote && !entry.forceSave) return Promise.resolve(true);
    entry.error = null;
    // Start in a microtask so pending is assigned before save/persist/publish run.
    entry.pending = Promise.resolve().then(async () => {
      try {
        while (entry.note !== entry.savedNote || entry.forceSave) {
          const sentNote = entry.note;
          await this.save(entry.id, sentNote);
          entry.savedNote = sentNote;
          entry.forceSave = false;
          this.version++;
          this.persist(entry);
          this.publish();
        }
        return true;
      } catch (caught) {
        entry.error = caught instanceof Error ? caught.message : "Die Notiz konnte nicht gespeichert werden.";
        return false;
      } finally {
        entry.pending = null;
        this.persist(entry);
        this.publish();
      }
    });
    this.persist(entry);
    this.publish();
    return entry.pending;
  }

  /** Flushes all drafts, but only the current episode's result gates its draw action. */
  saveNow = async (): Promise<boolean> => {
    let currentResult = Promise.resolve(true);
    for (const entry of this.entries.values()) {
      const result = this.flushEntry(entry);
      if (entry.id === this.currentId) currentResult = result;
    }
    return currentResult;
  };

  /** Cancels debounce timers; in-flight saves finish and latest drafts stay recoverable. */
  stopTimers() {
    this.entries.forEach((entry) => this.clearTimer(entry));
  }
}

/** Browser-scoped registry: remounted editors retain the same serialized write queue. */
export class EpisodeNoteEditorRegistry {
  private readonly editors = new Map<string, EpisodeNoteEditor>();

  has(userId: string): boolean {
    return this.editors.has(userId);
  }

  getOrCreate(options: EditorOptions): EpisodeNoteEditor {
    const existing = this.editors.get(options.userId);
    if (existing) return existing;
    const editor = new EpisodeNoteEditor(options);
    this.editors.set(options.userId, editor);
    return editor;
  }
}
