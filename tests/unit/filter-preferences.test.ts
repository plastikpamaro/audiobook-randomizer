import { describe, expect, it, vi } from "vitest";
import {
  createFilterStore, defaultHistoryFilters, defaultLibraryFilters, filterStorageKey,
  parseHistoryFilters, parseLibraryFilters,
} from "@/lib/filter-preferences";

const seriesId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("Persistente Filter", () => {
  it("übernimmt alle Bibliotheksfilter und gültige Kalenderdaten", () => {
    const filters = { search: "Sonderfolge", seriesFilter: seriesId, statusFilter: "future", releaseFrom: "2024-02-29", releaseTo: "2026-10-07", favoritesOnly: true };
    expect(parseLibraryFilters(filters)).toEqual(filters);
    expect(parseHistoryFilters({ search: "Nummer 7", status: "skipped", favoritesOnly: true })).toEqual({ search: "Nummer 7", status: "skipped", favoritesOnly: true });
  });

  it.each([null, [], 7, "falsch"])("fällt bei ungültiger Struktur %j auf Standardwerte zurück", (value) => {
    expect(parseLibraryFilters(value)).toEqual(defaultLibraryFilters);
    expect(parseHistoryFilters(value)).toEqual(defaultHistoryFilters);
  });

  it("verwirft ungültige Einzelwerte, ohne gültige Suchbegriffe zu verlieren", () => {
    expect(parseLibraryFilters({ search: "Krimi", seriesFilter: "missing", statusFilter: ["heard"], releaseFrom: "2025-02-29", releaseTo: "2026-99-01", favoritesOnly: "true" })).toEqual({ ...defaultLibraryFilters, search: "Krimi" });
    expect(parseHistoryFilters({ search: "Krimi", status: "available", favoritesOnly: 1 })).toEqual({ ...defaultHistoryFilters, search: "Krimi" });
  });

  it("trennt Accounts und Seiten und stellt gespeicherte Werte in einem neuen Store wieder her", () => {
    const storage = memoryStorage();
    const libraryKey = filterStorageKey("first-user", "library");
    const store = createFilterStore(libraryKey, defaultLibraryFilters, parseLibraryFilters, () => storage);
    store.update({ search: "Bibi", seriesFilter: seriesId, statusFilter: "heard", releaseFrom: "2026-01-01", releaseTo: "2026-12-31", favoritesOnly: true });
    const restored = createFilterStore(libraryKey, defaultLibraryFilters, parseLibraryFilters, () => storage);
    expect(restored.getSnapshot()).toEqual(store.getSnapshot());
    expect(createFilterStore(filterStorageKey("second-user", "library"), defaultLibraryFilters, parseLibraryFilters, () => storage).getSnapshot()).toEqual(defaultLibraryFilters);
    expect(createFilterStore(filterStorageKey("first-user", "history"), defaultHistoryFilters, parseHistoryFilters, () => storage).getSnapshot()).toEqual(defaultHistoryFilters);
  });

  it("liefert beim serverseitigen Rendern stabile Standardwerte und cached den Browser-Snapshot", () => {
    const storage = memoryStorage();
    const key = filterStorageKey("user", "history");
    storage.setItem(key, JSON.stringify({ search: "Drei ???", status: "heard", favoritesOnly: true }));
    const store = createFilterStore(key, defaultHistoryFilters, parseHistoryFilters, () => storage);
    expect(store.getServerSnapshot()).toBe(defaultHistoryFilters);
    expect(store.getSnapshot()).toEqual({ search: "Drei ???", status: "heard", favoritesOnly: true });
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(store.getServerSnapshot()).toBe(defaultHistoryFilters);
  });

  it("benachrichtigt Abonnenten, übernimmt externe Änderungen und entfernt gespeicherte Filter beim Zurücksetzen", () => {
    const storage = memoryStorage();
    const key = filterStorageKey("user", "history");
    const store = createFilterStore(key, defaultHistoryFilters, parseHistoryFilters, () => storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.update({ status: "skipped" });
    expect(listener).toHaveBeenCalledTimes(1);
    storage.setItem(key, JSON.stringify({ search: "Neu", favoritesOnly: true }));
    store.refresh();
    expect(store.getSnapshot()).toEqual({ search: "Neu", status: "all", favoritesOnly: true });
    expect(listener).toHaveBeenCalledTimes(2);
    store.reset();
    expect(storage.getItem(key)).toBeNull();
    expect(store.getSnapshot()).toBe(defaultHistoryFilters);
    unsubscribe();
    store.update({ search: "Später" });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("toleriert beschädigte JSON-Daten und gesperrten Browserspeicher", () => {
    const storage = memoryStorage();
    storage.setItem("broken", "{invalid");
    expect(createFilterStore("broken", defaultHistoryFilters, parseHistoryFilters, () => storage).getSnapshot()).toBe(defaultHistoryFilters);
    const store = createFilterStore("blocked", defaultHistoryFilters, parseHistoryFilters, () => { throw new Error("Storage is blocked"); });
    expect(store.getSnapshot()).toBe(defaultHistoryFilters);
    expect(() => store.update({ search: "Bleibt hier", favoritesOnly: true })).not.toThrow();
    const unsubscribe = store.subscribe(vi.fn());
    expect(store.getSnapshot()).toEqual({ search: "Bleibt hier", status: "all", favoritesOnly: true });
    unsubscribe();
    expect(() => store.reset()).not.toThrow();
    expect(store.getSnapshot()).toBe(defaultHistoryFilters);
  });
});
