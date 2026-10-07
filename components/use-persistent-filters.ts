"use client";

import { useSyncExternalStore } from "react";
import {
  createFilterStore, defaultHistoryFilters, defaultLibraryFilters, filterStorageKey,
  parseHistoryFilters, parseLibraryFilters, type HistoryFilters, type LibraryFilters,
} from "@/lib/filter-preferences";

const libraryStores = new Map<string, ReturnType<typeof createFilterStore<LibraryFilters>>>();
const historyStores = new Map<string, ReturnType<typeof createFilterStore<HistoryFilters>>>();

export function useLibraryFilters(userId: string) {
  let store = libraryStores.get(userId);
  if (!store) {
    store = createFilterStore(filterStorageKey(userId, "library"), defaultLibraryFilters, parseLibraryFilters);
    if (typeof window !== "undefined") libraryStores.set(userId, store);
  }
  const filters = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return [filters, store.update, store.reset] as const;
}

export function useHistoryFilters(userId: string) {
  let store = historyStores.get(userId);
  if (!store) {
    store = createFilterStore(filterStorageKey(userId, "history"), defaultHistoryFilters, parseHistoryFilters);
    if (typeof window !== "undefined") historyStores.set(userId, store);
  }
  const filters = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return [filters, store.update, store.reset] as const;
}
