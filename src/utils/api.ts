import { Playlist, AudioTrack, SubtitleCue } from "../types";

export class ApiClient {
  private static apiUrl: string | null =
    localStorage.getItem("gengolura_api_url");

  public static setApiUrl(url: string | null) {
    this.apiUrl = url;
    if (url) {
      localStorage.setItem("gengolura_api_url", url);
    } else {
      localStorage.removeItem("gengolura_api_url");
    }
  }

  public static getApiUrl(): string | null {
    return this.apiUrl;
  }

  public static isConfigured(): boolean {
    return !!this.apiUrl;
  }

  private static async request(endpoint: string, options: RequestInit = {}) {
    if (!this.apiUrl) return null;

    const url = `${this.apiUrl.replace(/\/$/, "")}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    try {
      const response = await fetch(url, { ...options, headers });
      if (!response.ok) {
        throw new Error(`API Request failed: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("API Error:", error);
      return null;
    }
  }

  // Playlists
  public static async getAllPlaylists(): Promise<Playlist[] | null> {
    return this.request("/playlists");
  }

  public static async savePlaylist(playlist: Playlist): Promise<void> {
    // 1. Save metadata
    const dbPlaylist = {
      ...playlist,
      tracks: playlist.tracks.map((t) => ({
        ...t,
        audioFile: null,
        vttFile: null,
      })),
    };
    await this.request("/playlists", {
      method: "POST",
      body: JSON.stringify(dbPlaylist),
    });

    // 2. Upload files for each track
    for (const track of playlist.tracks) {
      await this.syncTrackFiles(track);
    }
  }

  public static async deletePlaylist(id: string): Promise<void> {
    await this.request(`/playlists/${id}`, { method: "DELETE" });
  }

  // Standalone Tracks
  public static async getAllStandaloneTracks(): Promise<AudioTrack[] | null> {
    return this.request("/tracks/standalone");
  }

  public static async saveStandaloneTrack(track: AudioTrack): Promise<void> {
    // 1. Save metadata
    const dbTrack = {
      ...track,
      audioFile: null,
      vttFile: null,
    };
    await this.request("/tracks/standalone", {
      method: "POST",
      body: JSON.stringify(dbTrack),
    });

    // 2. Sync files
    await this.syncTrackFiles(track);
  }

  private static async syncTrackFiles(track: AudioTrack) {
    if (track.audioFile instanceof File) {
      await this.uploadFile(track.id, "audio", track.audioFile);
    }
    if (track.vttFile instanceof File) {
      await this.uploadFile(track.id, "vtt", track.vttFile);
    }
  }

  private static async uploadFile(
    trackId: string,
    type: "audio" | "vtt",
    file: File,
  ) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);

    const url = `${this.apiUrl?.replace(/\/$/, "")}/tracks/${trackId}/files`;

    try {
      const response = await fetch(url, {
        method: "POST",
        body: formData,
        // Don't set Content-Type header, fetch will set it with boundary
      });
      if (!response.ok) {
        throw new Error(`File upload failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Error uploading ${type} for track ${trackId}:`, error);
    }
  }

  public static async fetchFile(
    trackId: string,
    type: "audio" | "vtt",
  ): Promise<File | null> {
    const url = `${this.apiUrl?.replace(/\/$/, "")}/tracks/${trackId}/files/${type}`;

    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const blob = await response.blob();
      const filename =
        response.headers.get("x-filename") ||
        (type === "audio" ? "audio.mp3" : "transcript.vtt");
      return new File([blob], filename, { type: blob.type });
    } catch (error) {
      console.error(`Error fetching ${type} for track ${trackId}:`, error);
      return null;
    }
  }

  public static async deleteStandaloneTrack(id: string): Promise<void> {
    await this.request(`/tracks/standalone/${id}`, { method: "DELETE" });
  }

  // Playback State
  public static async savePlaybackState(
    trackId: string,
    playlistId: string | null,
    currentTime: number,
  ): Promise<void> {
    await this.request("/playback-state", {
      method: "POST",
      body: JSON.stringify({ trackId, playlistId, currentTime }),
    });
  }

  public static async getPlaybackState(): Promise<{
    trackId: string;
    playlistId: string | null;
    currentTime: number;
  } | null> {
    return this.request("/playback-state");
  }
}
