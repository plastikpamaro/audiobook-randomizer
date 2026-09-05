export type Role = "owner" | "admin" | "member";

export interface User {
  id: string;
  email: string;
  role: Role;
}

export interface EpisodeLink {
  id: string;
  label: string;
  url: string;
  sortOrder: number;
}

export interface EpisodeSummary {
  id: string;
  episodeKey: string;
  seriesId: string;
  seriesName: string;
  seriesKey: string;
  accentColor: string;
  title: string;
  numberLabel: string | null;
  sortOrder: number | null;
  releaseDate: string | null;
  durationMinutes: number | null;
  priorityOnRelease: boolean;
  archived: boolean;
  favorite: boolean;
  note: string;
  ratingAverage: number | null;
  ratingCount: number;
  status: "available" | "heard" | "future" | "archived";
  roundNumber: number;
  links: EpisodeLink[];
}

export interface SeriesOverview {
  id: string;
  seriesKey: string;
  name: string;
  description: string;
  accentColor: string;
  archived: boolean;
  roundNumber: number;
  totalCount: number;
  remainingCount: number;
  heardCount: number;
  futureCount: number;
}

export interface Preset {
  id: string;
  name: string;
  seriesIds: string[];
}

export interface ActiveDraw {
  id: string;
  status: "active" | "heard" | "skipped";
  sourceType: "random" | "bulk";
  drawnAt: string;
  resolvedAt: string | null;
  correctedAt: string | null;
  roundNumber: number;
  presetId: string | null;
  selectionSeriesIds: string[];
  wasPriority: boolean;
  rating: number | null;
  ratingEditable: boolean;
  episode: EpisodeSummary;
}

export interface HistoryItem extends ActiveDraw {
  canRestore: boolean;
}

export interface ActivityPoint {
  bucket: string;
  heard: number;
  skipped: number;
  minutes: number;
}

export interface AnalyticsData {
  range: { from: string; to: string };
  heard: number;
  skipped: number;
  skipRate: number;
  minutes: number;
  currentStreak: number;
  longestStreak: number;
  activity: ActivityPoint[];
  topSeries: Array<{ name: string; heard: number; minutes: number }>;
  ratingAverage: number | null;
  ratedCount: number;
  ratingDistribution: Array<{ score: number; count: number }>;
  topRatedEpisodes: Array<{ title: string; seriesName: string; average: number; count: number }>;
  topRatedSeries: Array<{ name: string; average: number; count: number }>;
  progress: SeriesOverview[];
}
