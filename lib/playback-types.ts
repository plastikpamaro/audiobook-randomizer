export interface PlaybackProgress {
  positionSeconds: number;
  durationSeconds: number | null;
  updatedAt: string | null;
}

export interface PlaybackSave {
  sessionId: string;
  sequence: number;
  positionSeconds: number;
  durationSeconds: number;
  finished: boolean;
}
