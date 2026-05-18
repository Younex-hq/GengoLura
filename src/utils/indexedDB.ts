import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Playlist, AudioTrack } from '../types';

interface AppDB extends DBSchema {
  playlists: {
    key: string;
    value: Playlist;
  };
  standaloneTracks: {
    key: string;
    value: AudioTrack;
  };
  appState: {
    key: string;
    value: any;
  };
}

let dbPromise: Promise<IDBPDatabase<AppDB>>;

export function initDB() {
  dbPromise = openDB<AppDB>('AudioTranscribeApp', 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('playlists', { keyPath: 'id' });
        db.createObjectStore('standaloneTracks', { keyPath: 'id' });
      }
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains('appState')) {
          db.createObjectStore('appState');
        }
      }
    },
  });
}

export async function savePlaybackState(trackId: string, playlistId: string | null, currentTime: number) {
  const db = await dbPromise;
  await db.put('appState', { trackId, playlistId, currentTime }, 'lastPlaybackState');
}

export async function getPlaybackState(): Promise<{ trackId: string; playlistId: string | null; currentTime: number } | undefined> {
  const db = await dbPromise;
  return db.get('appState', 'lastPlaybackState');
}

export async function savePlaylist(playlist: Playlist) {
  const db = await dbPromise;
  
  // Create a deep copy for DB to avoid modifying the in-memory object
  const dbPlaylist: Playlist = {
    ...playlist,
    tracks: playlist.tracks.map(t => {
      if (t.storageMode === 'device') {
        return {
          ...t,
          audioFile: null,
          vttFile: null
        };
      }
      return t;
    })
  };
  
  await db.put('playlists', dbPlaylist);
}

export async function getAllPlaylists(): Promise<Playlist[]> {
  const db = await dbPromise;
  return db.getAll('playlists');
}

export async function getPlaylist(id: string): Promise<Playlist | undefined> {
  const db = await dbPromise;
  return db.get('playlists', id);
}

export async function deletePlaylist(id: string) {
  const db = await dbPromise;
  await db.delete('playlists', id);
}

export async function saveStandaloneTrack(track: AudioTrack) {
  const db = await dbPromise;
  
  const dbTrack: AudioTrack = track.storageMode === 'device' ? {
    ...track,
    audioFile: null,
    vttFile: null
  } : track;
  
  await db.put('standaloneTracks', dbTrack);
}

export async function getAllStandaloneTracks(): Promise<AudioTrack[]> {
  const db = await dbPromise;
  return db.getAll('standaloneTracks');
}

export async function deleteStandaloneTrack(id: string) {
  const db = await dbPromise;
  await db.delete('standaloneTracks', id);
}
