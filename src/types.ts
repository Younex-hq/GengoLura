export interface AudioTrack {
  id: string;
  name: string;
  audioFile: File | null;
  vttFile?: File | null;
  bookmarkTime?: number;
  bookmarkText?: string;
  audioFileName?: string;
  vttFileName?: string;
  storageMode?: 'browser' | 'device';
  transcriptionMode?: 'sentence' | 'word';
  sourceTrackId?: string; // For bookmarks to reference original track
}

export interface Playlist {
  id: string;
  name: string;
  tracks: AudioTrack[];
}

export interface SubtitleCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}
