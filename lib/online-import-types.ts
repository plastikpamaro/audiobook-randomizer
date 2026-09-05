export type ImportSourceKind = "drei_fragezeichen" | "tkkg" | "csv" | "json" | "rss";
export type ImportRunStatus = "running" | "awaiting_confirmation" | "succeeded" | "failed" | "needs_review" | "not_modified";

export interface NormalizedImportLink {
  label: string;
  url: string;
}

export interface NormalizedImportEpisode {
  externalId: string;
  title: string;
  numberLabel: string | null;
  sortOrder: number | null;
  releaseDate: string | null;
  durationMinutes: number | null;
  priorityOnRelease: boolean;
  links: NormalizedImportLink[];
  canonicalUrl: string | null;
}

export interface ParsedImportFeed {
  episodes: NormalizedImportEpisode[];
  issues: Array<{ item: string; message: string }>;
  warnings: string[];
}

export interface ImportSourceSummary {
  id: string;
  seriesId: string;
  seriesName: string;
  kind: ImportSourceKind;
  name: string;
  url: string | null;
  enabled: boolean;
  confirmed: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastItemCount: number | null;
  pendingProposalCount: number;
}

export interface ImportRunSummary {
  id: string;
  sourceId: string;
  triggerType: "preview" | "manual" | "scheduled";
  status: ImportRunStatus;
  fetchedItemCount: number;
  newItemCount: number;
  changedItemCount: number;
  invalidItemCount: number;
  warningCount: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ImportProposalSummary {
  id: string;
  sourceId: string;
  runId: string;
  externalId: string;
  proposalType: "create" | "link" | "update";
  candidateEpisodeId: string | null;
  candidateTitle: string | null;
  episode: NormalizedImportEpisode;
  fieldChanges: Record<string, { from: unknown; to: unknown }>;
  status: "pending" | "accepted" | "rejected";
}

export interface ImportPreviewResult {
  run: ImportRunSummary;
  proposals: ImportProposalSummary[];
  warnings: string[];
}
