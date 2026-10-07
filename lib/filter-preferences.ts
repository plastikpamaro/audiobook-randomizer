export interface LibraryFilters {
  search: string;
  seriesFilter: string;
  statusFilter: "all" | "available" | "heard" | "future" | "archived";
  releaseFrom: string;
  releaseTo: string;
  favoritesOnly: boolean;
}

export interface HistoryFilters {
  search: string;
  status: "all" | "heard" | "skipped";
  favoritesOnly: boolean;
}

export const defaultLibraryFilters: LibraryFilters = {
  search: "", seriesFilter: "all", statusFilter: "all", releaseFrom: "", releaseTo: "", favoritesOnly: false,
};

export const defaultHistoryFilters: HistoryFilters = {
  search: "", status: "all", favoritesOnly: false,
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateFilter(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

export function parseLibraryFilters(value: unknown): LibraryFilters {
  const stored = fields(value);
  return {
    search: typeof stored.search === "string" ? stored.search : "",
    seriesFilter: typeof stored.seriesFilter === "string" && uuidPattern.test(stored.seriesFilter) ? stored.seriesFilter : "all",
    statusFilter: typeof stored.statusFilter === "string" && ["available", "heard", "future", "archived"].includes(stored.statusFilter) ? stored.statusFilter as LibraryFilters["statusFilter"] : "all",
    releaseFrom: dateFilter(stored.releaseFrom),
    releaseTo: dateFilter(stored.releaseTo),
    favoritesOnly: stored.favoritesOnly === true,
  };
}

export function parseHistoryFilters(value: unknown): HistoryFilters {
  const stored = fields(value);
  return {
    search: typeof stored.search === "string" ? stored.search : "",
    status: stored.status === "heard" || stored.status === "skipped" ? stored.status : "all",
    favoritesOnly: stored.favoritesOnly === true,
  };
}

export function filterStorageKey(userId: string, page: "library" | "history"): string {
  return `audiobook-randomizer:filters:v1:${userId}:${page}`;
}

type FilterStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A cached snapshot keeps React hydration stable and survives blocked browser storage. */
export function createFilterStore<T extends object>(
  key: string,
  defaults: T,
  parse: (value: unknown) => T,
  getStorage: () => FilterStorage = () => window.localStorage,
) {
  let snapshot: T | undefined;
  const listeners = new Set<() => void>();

  function read(): T | undefined {
    let raw: string | null;
    try {
      raw = getStorage().getItem(key);
    } catch {
      return undefined;
    }
    try {
      return raw === null ? defaults : parse(JSON.parse(raw));
    } catch {
      return defaults;
    }
  }

  function getSnapshot(): T {
    snapshot ??= read() ?? defaults;
    return snapshot;
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function refresh() {
    const next = read();
    if (next === undefined) return;
    if (JSON.stringify(next) === JSON.stringify(getSnapshot())) return;
    snapshot = next;
    notify();
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    refresh();
    function storageChanged(event: StorageEvent) {
      if (event.key === key || event.key === null) refresh();
    }
    if (typeof window !== "undefined") window.addEventListener("storage", storageChanged);
    return () => {
      listeners.delete(listener);
      if (typeof window !== "undefined") window.removeEventListener("storage", storageChanged);
    };
  }

  function update(patch: Partial<T>) {
    snapshot = parse({ ...getSnapshot(), ...patch });
    try { getStorage().setItem(key, JSON.stringify(snapshot)); } catch { /* Keep the current session usable. */ }
    notify();
  }

  function reset() {
    snapshot = defaults;
    try { getStorage().removeItem(key); } catch { /* Keep the current session usable. */ }
    notify();
  }

  return { getSnapshot, getServerSnapshot: () => defaults, subscribe, update, reset, refresh };
}
