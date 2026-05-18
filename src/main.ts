import {
  initDB,
  savePlaylist as dbSavePlaylist,
  getAllPlaylists as dbGetAllPlaylists,
  deletePlaylist as dbDeletePlaylist,
  saveStandaloneTrack as dbSaveStandaloneTrack,
  getAllStandaloneTracks as dbGetAllStandaloneTracks,
  deleteStandaloneTrack as dbDeleteStandaloneTrack,
  savePlaybackState as dbSavePlaybackState,
  getPlaybackState as dbGetPlaybackState,
} from "./utils/indexedDB";
import { AudioPlayer } from "./modules/player";
import { parseVTT } from "./modules/subtitles";
import { AudioTrack, Playlist, SubtitleCue } from "./types";
import { ApiClient } from "./utils/api";

// Wrappers for Storage (IndexedDB + External API)
async function savePlaylist(playlist: Playlist) {
  await dbSavePlaylist(playlist);
  if (ApiClient.isConfigured()) {
    await ApiClient.savePlaylist(playlist);
  }
}

async function getAllPlaylists(): Promise<Playlist[]> {
  if (ApiClient.isConfigured()) {
    const apiPlaylists = await ApiClient.getAllPlaylists();
    if (apiPlaylists) return apiPlaylists;
  }
  return dbGetAllPlaylists();
}

async function deletePlaylist(id: string) {
  await dbDeletePlaylist(id);
  if (ApiClient.isConfigured()) {
    await ApiClient.deletePlaylist(id);
  }
}

async function saveStandaloneTrack(track: AudioTrack) {
  await dbSaveStandaloneTrack(track);
  if (ApiClient.isConfigured()) {
    await ApiClient.saveStandaloneTrack(track);
  }
}

async function getAllStandaloneTracks(): Promise<AudioTrack[]> {
  if (ApiClient.isConfigured()) {
    const apiTracks = await ApiClient.getAllStandaloneTracks();
    if (apiTracks) return apiTracks;
  }
  return dbGetAllStandaloneTracks();
}

async function deleteStandaloneTrack(id: string) {
  await dbDeleteStandaloneTrack(id);
  if (ApiClient.isConfigured()) {
    await ApiClient.deleteStandaloneTrack(id);
  }
}

async function savePlaybackState(
  trackId: string,
  playlistId: string | null,
  currentTime: number,
) {
  await dbSavePlaybackState(trackId, playlistId, currentTime);
  if (ApiClient.isConfigured()) {
    await ApiClient.savePlaybackState(trackId, playlistId, currentTime);
  }
}

async function getPlaybackState() {
  if (ApiClient.isConfigured()) {
    const apiState = await ApiClient.getPlaybackState();
    if (apiState) return apiState;
  }
  return dbGetPlaybackState();
}

// State
let currentPlaylists: Playlist[] = [];
let standaloneTracks: AudioTrack[] = [];
let activePlaylistId: string | null = null;
let activeTrackId: string | null = null;
let activeTrack: AudioTrack | null = null;
let activeCues: SubtitleCue[] = [];
let speeds = [1, 1.25, 1.5, 2, 0.5, 0.75];
let currentSpeedIndex = 0;
let editingPlaylistId: string | null = null;
let editingTrack: { track: AudioTrack; playlist?: Playlist } | null = null;
let uploadTargetFolderId: string | null = null; // null means standalone

// Session cache to keep files in memory for Metadata-Only tracks during current session
const sessionFileCache = new Map<string, File>();

// UI Elements
const btnMenu = document.getElementById("btn-menu")!;
const sidebar = document.getElementById("sidebar")!;
// Create overlay dynamically
const sidebarOverlay = document.createElement("div");
sidebarOverlay.className = "sidebar-overlay";
document.body.appendChild(sidebarOverlay);

const playlistListEl = document.getElementById("playlist-list")!;
const currentTrackTitleEl = document.getElementById("current-track-title")!;
const transcriptContainerEl = document.getElementById("transcript-container")!;
const playerTitleEl = document.getElementById("player-title")!;
const playerPlaylistEl = document.getElementById("player-playlist")!;
const timeCurrentEl = document.getElementById("time-current")!;
const timeTotalEl = document.getElementById("time-total")!;
const progressBarEl = document.getElementById(
  "progress-bar",
) as HTMLInputElement;

const btnPlayPause = document.getElementById("btn-play-pause")!;
const svgPlay = document.getElementById("svg-play")!;
const svgPause = document.getElementById("svg-pause")!;
const btnRewind = document.getElementById("btn-rewind")!;
const btnForward = document.getElementById("btn-forward")!;
const btnBookmarkMobile = document.getElementById("btn-bookmark-mobile")!;
const btnBookmarkDesktop = document.getElementById("btn-bookmark-desktop")!;
const btnSpeed = document.getElementById("btn-speed")!;
const btnLoop = document.getElementById("btn-loop")!;

const uploadModal = document.getElementById("upload-modal")!;
const btnNewFolder = document.getElementById("btn-new-folder")!;
const btnAddTrack = document.getElementById("btn-add-track")!;
const btnCloseModal = document.getElementById("btn-close-modal")!;
const filesUploadInput = document.getElementById(
  "files-upload",
) as HTMLInputElement;
const filesDropzone = document.getElementById("files-dropzone")!;
const pairingListEl = document.getElementById("pairing-list")!;
const btnSavePlaylist = document.getElementById("btn-save-playlist")!;
const playlistNameInput = document.getElementById(
  "playlist-name",
) as HTMLInputElement;

const btnSettings = document.getElementById("btn-settings")!;
const settingsModal = document.getElementById("settings-modal")!;
const btnCloseSettings = document.getElementById("btn-close-settings")!;
const btnSaveSettings = document.getElementById("btn-save-settings")!;
const apiUrlInput = document.getElementById("api-url") as HTMLInputElement;

// Temporary state for the modal
let tempAudioFiles: (File | { name: string; isMissing: true })[] = [];
let tempVttFiles: (File | { name: string; isMissing: true })[] = [];

// Playback state persistence variables
async function persistPlaybackState() {
  if (!activeTrackId) return;
  const playlistId = activePlaylistId || "standalone";
  const currentTime = player.currentTime;
  try {
    await savePlaybackState(activeTrackId, playlistId, currentTime);
  } catch (e) {
    console.error("Failed to save playback state to IndexedDB:", e);
  }
}

// Initialize Player
const player = new AudioPlayer(
  (currentTime, duration) => {
    // Update progress bar
    timeCurrentEl.textContent = formatTime(currentTime);
    timeTotalEl.textContent = formatTime(duration);
    if (duration > 0) {
      const percentage = (currentTime / duration) * 100;
      progressBarEl.value = percentage.toString();
      progressBarEl.style.setProperty("--progress", `${percentage}%`);
    }

    // Highlight transcript
    updateActiveCue(currentTime);
  },
  () => {
    updatePlayPauseUI(false);
    // Save when track ends
    persistPlaybackState();
    // Auto-play next track logic could go here
  },
);

function updatePlayPauseUI(isPlaying: boolean) {
  if (isPlaying) {
    svgPlay.style.display = "none";
    svgPause.style.display = "block";
  } else {
    svgPlay.style.display = "block";
    svgPause.style.display = "none";
  }
}

// Format seconds to mm:ss
function formatTime(seconds: number): string {
  if (isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function init() {
  initDB();
  await loadLibrary();
  setupEventListeners();
  await restorePlaybackState();
}

async function loadLibrary() {
  currentPlaylists = await getAllPlaylists();
  standaloneTracks = await getAllStandaloneTracks();
  renderSidebar();
}

async function restorePlaybackState() {
  try {
    const state = await getPlaybackState();
    if (state) {
      let matchedTrack: AudioTrack | undefined = undefined;
      let matchedPlaylist: Playlist | undefined = undefined;

      if (state.playlistId === "standalone") {
        matchedTrack = standaloneTracks.find((t) => t.id === state.trackId);
        matchedPlaylist = { id: "standalone", name: "Standalone", tracks: [] };
      } else if (state.playlistId) {
        matchedPlaylist = currentPlaylists.find(
          (p) => p.id === state.playlistId,
        );
        if (matchedPlaylist) {
          matchedTrack = matchedPlaylist.tracks.find(
            (t) => t.id === state.trackId,
          );
        }
      }

      if (matchedTrack && matchedPlaylist) {
        if (state.playlistId !== "standalone") {
          activePlaylistId = state.playlistId;
        }
        await playTrack(
          matchedTrack,
          matchedPlaylist,
          false,
          state.currentTime,
        );
        renderSidebar();
      }
    }
  } catch (e) {
    console.error("Failed to restore playback state from IndexedDB:", e);
  }
}

function renderSidebar() {
  playlistListEl.innerHTML = "";

  // Sort Folders: Bookmarks first, then others alphabetically
  const sortedPlaylists = [...currentPlaylists].sort((a, b) => {
    if (a.name === "Bookmarks") return -1;
    if (b.name === "Bookmarks") return 1;
    return a.name.localeCompare(b.name);
  });

  // Render Folders
  sortedPlaylists.forEach((playlist) => {
    const li = document.createElement("li");
    li.className = `playlist-item ${playlist.id === activePlaylistId ? "active-folder" : ""}`;

    const folderHeader = document.createElement("div");
    folderHeader.className = "playlist-folder-header";

    const nameSpan = document.createElement("span");
    nameSpan.className = "playlist-name-text";
    nameSpan.title = playlist.name; // Show full name on hover
    nameSpan.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> ${playlist.name}`;

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "playlist-actions";

    const addBtn = document.createElement("button");
    addBtn.className = "btn-add-to-folder";
    addBtn.title = "Add Audio/VTT to Folder";
    addBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openUploadModal(playlist.id);
    });

    const editBtn = document.createElement("button");
    editBtn.className = "btn-edit-playlist";
    editBtn.title = "Rename Folder";
    editBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditPlaylistModal(playlist);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-delete-playlist";
    deleteBtn.title = "Delete Folder";
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete folder "${playlist.name}" and all its tracks?`)) {
        await deletePlaylist(playlist.id);
        if (activePlaylistId === playlist.id) activePlaylistId = null;
        await loadLibrary();
      }
    });

    actionsDiv.appendChild(addBtn);
    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(deleteBtn);

    folderHeader.appendChild(nameSpan);
    folderHeader.appendChild(actionsDiv);

    folderHeader.addEventListener("click", () => {
      activePlaylistId = activePlaylistId === playlist.id ? null : playlist.id;
      renderSidebar();
    });

    li.appendChild(folderHeader);

    if (playlist.id === activePlaylistId) {
      const tracksList = document.createElement("ul");
      tracksList.className = "tracks-list";
      playlist.tracks.forEach((track) => {
        tracksList.appendChild(createTrackElement(track, playlist));
      });
      li.appendChild(tracksList);
    }

    playlistListEl.appendChild(li);
  });

  // Render Standalone Tracks
  standaloneTracks.forEach((track) => {
    playlistListEl.appendChild(createTrackElement(track));
  });
}

function createTrackElement(track: AudioTrack, playlist?: Playlist) {
  const trackLi = document.createElement("li");
  trackLi.className = `track-item ${track.id === activeTrackId ? "active-track" : ""}`;

  const contentDiv = document.createElement("div");
  contentDiv.className = "track-content";
  contentDiv.title = track.name; // Show full name on hover

  const subText =
    track.audioFileName && track.id.startsWith("bookmark-")
      ? `<span class="track-subtext">${track.audioFileName}</span>`
      : "";

  contentDiv.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="track-svg-icon"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
    <div class="track-info-container">
      <span class="track-name-text">${track.name}</span>
      ${subText}
    </div>
  `;

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "track-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "btn-track-edit";
  editBtn.title = "Edit Track / Upload VTT";
  editBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEditTrackModal(track, playlist);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn-track-delete";
  deleteBtn.title = "Delete Track";
  deleteBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (confirm(`Delete track "${track.name}"?`)) {
      if (playlist) {
        playlist.tracks = playlist.tracks.filter((t) => t.id !== track.id);
        await savePlaylist(playlist);
      } else {
        await deleteStandaloneTrack(track.id);
      }
      if (activeTrackId === track.id) {
        activeTrackId = null;
        activeTrack = null;
        player.pause();
      }
      await loadLibrary();
    }
  });

  actionsDiv.appendChild(editBtn);
  actionsDiv.appendChild(deleteBtn);

  trackLi.appendChild(contentDiv);
  trackLi.appendChild(actionsDiv);

  trackLi.addEventListener("click", () => {
    if (activeTrackId !== track.id) {
      playTrack(
        track,
        playlist || { id: "standalone", name: "Standalone", tracks: [] },
      );
    }
  });

  return trackLi;
}

function openUploadModal(folderId: string | null = null) {
  uploadTargetFolderId = folderId;
  editingPlaylistId = null;

  let title = "Add Standalone Tracks";
  if (folderId === "new") {
    title = "Create New Playlist";
  } else if (folderId) {
    const folder = currentPlaylists.find((p) => p.id === folderId);
    title = `Add to ${folder ? folder.name : "Folder"}`;
  }

  document.querySelector(".modal-header h2")!.textContent = title;

  const editActions = document.getElementById("edit-track-actions");
  if (editActions) editActions.style.display = "none";

  // Hide playlist name input if adding tracks to existing folder or standalone
  const nameGroup = playlistNameInput.closest(".form-group") as HTMLElement;
  if (folderId !== "new") {
    nameGroup.style.display = "none";
  } else {
    nameGroup.style.display = "flex";
    playlistNameInput.value = "";
  }

  tempAudioFiles = [];
  tempVttFiles = [];
  uploadModal.classList.remove("hidden");
  renderPairingList();
}

function openEditPlaylistModal(playlist: Playlist) {
  editingPlaylistId = playlist.id;
  document.querySelector(".modal-header h2")!.textContent = "Rename Folder";
  playlistNameInput.value = playlist.name;
  const nameGroup = playlistNameInput.closest(".form-group") as HTMLElement;
  const nameLabel = nameGroup.querySelector("label")!;
  nameLabel.textContent = "Playlist Name";

  const editActions = document.getElementById("edit-track-actions");
  if (editActions) editActions.style.display = "none";

  // For renaming, we don't need the upload area or pairing list
  (document.querySelector(".upload-areas") as HTMLElement).style.display =
    "none";
  (document.querySelector(".pairing-section") as HTMLElement).style.display =
    "none";

  uploadModal.classList.remove("hidden");
}

function openEditTrackModal(track: AudioTrack, playlist?: Playlist) {
  editingTrack = { track, playlist };
  editingPlaylistId = null;
  uploadTargetFolderId = null;

  const modalTitle = uploadModal.querySelector(".modal-header h2")!;
  modalTitle.textContent = "Edit Track";

  const nameGroup = document.getElementById("playlist-name-group")!;
  const nameLabel = nameGroup.querySelector("label")!;
  nameLabel.textContent = "Track Title";
  playlistNameInput.value = track.name;
  nameGroup.style.display = "flex";

  // Hide upload parts for renaming
  (document.querySelector(".upload-areas") as HTMLElement).style.display =
    "none";
  (document.querySelector(".pairing-section") as HTMLElement).style.display =
    "none";

  // Ensure footer is visible
  (document.querySelector(".modal-footer") as HTMLElement).style.display =
    "flex";

  // Add/Update Replace VTT button
  let editActions = document.getElementById("edit-track-actions");
  if (!editActions) {
    editActions = document.createElement("div");
    editActions.id = "edit-track-actions";
    editActions.className = "form-group";
    document.querySelector(".modal-body")!.appendChild(editActions);
  }
  editActions.style.display = "flex";
  editActions.innerHTML = `
    <label>Transcript (.vtt)</label>
    <button class="btn-primary" style="background: var(--bg-highlight); color: var(--text-highlight); border: 1px solid var(--border-color); width: 100%; text-align: center;">
      ${track.vttFileName ? `Replace: ${track.vttFileName}` : "Add Transcript"}
    </button>
  `;

  const vttBtn = editActions.querySelector("button")!;
  vttBtn.onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".vtt";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        track.vttFile = file;
        track.vttFileName = file.name;
        vttBtn.textContent = `Replace: ${file.name}`;
      }
    };
    input.click();
  };

  uploadModal.classList.remove("hidden");
}

async function playTrack(
  track: AudioTrack,
  playlist: Playlist,
  autoPlay = true,
  startTime?: number,
) {
  activeTrackId = track.id;
  activeTrack = track;
  currentTrackTitleEl.textContent = track.name;
  playerTitleEl.textContent = track.name;
  playerPlaylistEl.textContent = playlist.name;

  // 1. Try to restore from session cache (if user just uploaded files in metadata-only mode)
  if (
    !track.audioFile &&
    track.audioFileName &&
    sessionFileCache.has(track.audioFileName)
  ) {
    track.audioFile = sessionFileCache.get(track.audioFileName)!;
  }
  if (
    !track.vttFile &&
    track.vttFileName &&
    sessionFileCache.has(track.vttFileName)
  ) {
    track.vttFile = sessionFileCache.get(track.vttFileName)!;
  }

  // 2. If still missing, try to borrow them from the source track if it exists
  if (!track.audioFile && track.sourceTrackId) {
    let source: AudioTrack | undefined;
    // Search standalone
    source = standaloneTracks.find((t) => t.id === track.sourceTrackId);
    if (!source) {
      // Search all playlists
      for (const p of currentPlaylists) {
        source = p.tracks.find((t) => t.id === track.sourceTrackId);
        if (source) break;
      }
    }
    if (source && source.audioFile) {
      track.audioFile = source.audioFile;
      if (!track.vttFile) track.vttFile = source.vttFile;
    }
  }

  // 3. Try to fetch from External API if configured
  if (ApiClient.isConfigured()) {
    if (!track.audioFile) {
      currentTrackTitleEl.textContent = "Fetching audio from server...";
      const audio = await ApiClient.fetchFile(track.id, "audio");
      if (audio) {
        track.audioFile = audio;
        // We do NOT save to IndexedDB here to keep the file temporary (Session only)
      }
    }
    if (!track.vttFile) {
      const vtt = await ApiClient.fetchFile(track.id, "vtt");
      if (vtt) {
        track.vttFile = vtt;
        // We do NOT save to IndexedDB here to keep the file temporary (Session only)
      }
    }
  }

  if (!track.audioFile) {
    currentTrackTitleEl.textContent = track.name + " (File Missing)";

    const vttInfo = track.vttFileName
      ? `<p>Transcript: <strong>${track.vttFileName}</strong></p>`
      : "";

    transcriptContainerEl.innerHTML = `
      <div class="empty-state recovery-state">
        <h2 class="recovery-title">Action Required</h2>
        <p class="recovery-desc">This track is in "Device Mode". Please provide the original files to play.</p>
        <div class="recovery-card">
          <p>Audio: <strong>${track.audioFileName}</strong></p>
          ${vttInfo}
        </div>
        <label class="btn-primary recovery-btn">
          Locate File(s)
          <input type="file" id="locate-file-input" style="display: none;" accept="audio/*,.vtt" multiple>
        </label>
      </div>
    `;

    const locateInput = document.getElementById(
      "locate-file-input",
    ) as HTMLInputElement;
    locateInput.addEventListener("change", (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      const audio = files.find((f) => f.name === track.audioFileName);
      const vtt = files.find((f) => f.name === track.vttFileName);

      if (audio) {
        // Update in memory and DB
        if (playlist.id === "standalone") {
          standaloneTracks.forEach((t) => {
            if (t.audioFileName === audio.name) t.audioFile = audio;
            if (vtt && t.vttFileName === vtt.name) t.vttFile = vtt;
          });
        } else {
          currentPlaylists.forEach((p) => {
            p.tracks.forEach((t) => {
              if (t.audioFileName === audio.name) t.audioFile = audio;
              if (vtt && t.vttFileName === vtt.name) t.vttFile = vtt;
            });
          });
        }
        playTrack(track, playlist); // Retry playing
      } else {
        alert(
          "The selected file does not match the required filename: " +
            track.audioFileName,
        );
      }
    });

    renderSidebar();
    return;
  }

  // Load and Parse VTT
  activeCues = [];
  if (track.vttFile) {
    try {
      activeCues = await parseVTT(track.vttFile);
    } catch (e) {
      console.error("Failed to parse VTT:", e);
    }
  }

  renderSidebar();
  renderTranscript();
  const initialTime = startTime !== undefined ? startTime : track.bookmarkTime;
  player.loadTrack(track.audioFile, autoPlay, initialTime);
  updatePlayPauseUI(autoPlay);
}

function renderTranscript() {
  transcriptContainerEl.innerHTML = "";
  if (activeCues.length === 0) {
    transcriptContainerEl.innerHTML =
      '<div class="empty-state">Transcript is empty.</div>';
    return;
  }

  const isWordMode = activeTrack?.transcriptionMode === "word";

  if (isWordMode) {
    const p = document.createElement("p");
    p.className = "word-transcript";

    activeCues.forEach((cue) => {
      const span = document.createElement("span");
      span.className = "word-cue";
      span.id = cue.id;
      span.textContent = cue.text + " ";

      span.addEventListener("click", () => {
        player.seek(cue.startTime);
        if (!player.isPlaying()) {
          player.play();
          updatePlayPauseUI(true);
        }
      });

      p.appendChild(span);
    });

    transcriptContainerEl.appendChild(p);
  } else {
    activeCues.forEach((cue) => {
      const div = document.createElement("div");
      div.className = "transcript-cue";
      div.id = cue.id;

      const timeSpan = document.createElement("span");
      timeSpan.className = "timestamp";
      timeSpan.textContent = `[${formatTime(cue.startTime)}]`;

      const textSpan = document.createElement("span");
      textSpan.textContent = cue.text;

      div.appendChild(timeSpan);
      div.appendChild(textSpan);

      div.addEventListener("click", () => {
        player.seek(cue.startTime);
        if (!player.isPlaying()) {
          player.play();
          updatePlayPauseUI(true);
        }
      });

      transcriptContainerEl.appendChild(div);
    });
  }
}

let lastActiveCueId: string | null = null;
function updateActiveCue(currentTime: number) {
  if (activeCues.length === 0) return;

  const isWordMode = activeTrack?.transcriptionMode === "word";

  if (isWordMode) {
    let currentCueId: string | null = null;

    activeCues.forEach((cue) => {
      const el = document.getElementById(cue.id);
      if (el) {
        if (currentTime >= cue.startTime && currentTime <= cue.endTime) {
          el.classList.add("active");
          el.classList.add("spoken");
          currentCueId = cue.id;
        } else {
          el.classList.remove("active");
          if (currentTime > cue.endTime) {
            el.classList.add("spoken");
          } else {
            el.classList.remove("spoken");
          }
        }
      }
    });

    if (currentCueId && lastActiveCueId !== currentCueId) {
      const activeEl = document.getElementById(currentCueId);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      lastActiveCueId = currentCueId;
    }
    return;
  }

  // Generic logic for sentence mode
  const currentCue = activeCues.find(
    (c) => currentTime >= c.startTime && currentTime <= c.endTime,
  );

  if (currentCue && currentCue.id !== lastActiveCueId) {
    const activeEl = document.getElementById(currentCue.id);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
      activeEl.classList.add("active");
    }

    if (lastActiveCueId) {
      const oldEl = document.getElementById(lastActiveCueId);
      if (oldEl) oldEl.classList.remove("active");
    }
    lastActiveCueId = currentCue.id;
  } else if (!currentCue && lastActiveCueId) {
    const oldEl = document.getElementById(lastActiveCueId);
    if (oldEl) oldEl.classList.remove("active");
    lastActiveCueId = null;
  }
}

function setupEventListeners() {
  // Player Controls
  btnPlayPause.addEventListener("click", () => {
    if (activeTrackId) {
      player.togglePlay();
      updatePlayPauseUI(player.isPlaying());
      persistPlaybackState();
    }
  });

  btnRewind.addEventListener("click", () => {
    player.jump(-5);
    persistPlaybackState();
  });
  btnForward.addEventListener("click", () => {
    player.jump(5);
    persistPlaybackState();
  });

  btnSpeed.addEventListener("click", () => {
    currentSpeedIndex = (currentSpeedIndex + 1) % speeds.length;
    const speed = speeds[currentSpeedIndex];
    player.setSpeed(speed);
    btnSpeed.textContent = `${speed}x`;
  });

  btnLoop.addEventListener("click", () => {
    const isLooping = player.toggleLoop();
    btnLoop.classList.toggle("active", isLooping);
  });

  progressBarEl.addEventListener("input", (e) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    progressBarEl.style.setProperty("--progress", `${val}%`);
    if (player.duration) {
      const seekTime = (val / 100) * player.duration;
      player.seek(seekTime);
    }
  });

  progressBarEl.addEventListener("change", () => {
    persistPlaybackState();
  });

  const btnSidebarClose = document.getElementById("btn-sidebar-close")!;

  const toggleSidebar = () => {
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle("open");
      sidebarOverlay.classList.toggle("open");
    } else {
      const app = document.getElementById("app")!;
      app.classList.toggle("sidebar-collapsed");
    }
  };

  btnMenu.addEventListener("click", toggleSidebar);
  btnSidebarClose.addEventListener("click", toggleSidebar);

  sidebarOverlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("open");
  });

  const handleBookmark = async () => {
    if (!activeTrackId || !activeTrack) return;

    const currentTrack = activeTrack;

    let bookmarkPlaylist = currentPlaylists.find((p) => p.name === "Bookmarks");
    if (!bookmarkPlaylist) {
      bookmarkPlaylist = {
        id: "playlist-bookmarks",
        name: "Bookmarks",
        tracks: [],
      };
    }

    let bTime = player.currentTime;
    let bText = "Bookmark at " + formatTime(bTime);

    if (lastActiveCueId) {
      const activeCue = activeCues.find((c) => c.id === lastActiveCueId);
      if (activeCue) {
        bTime = activeCue.startTime;
        bText = activeCue.text;
      }
    }

    const sourceId = currentTrack.sourceTrackId || currentTrack.id;

    const newBookmarkTrack: AudioTrack = {
      id: `bookmark-${Date.now()}`,
      name: bText,
      audioFile: sourceId ? null : currentTrack.audioFile,
      vttFile: sourceId ? null : currentTrack.vttFile,
      bookmarkTime: bTime,
      bookmarkText: bText,
      audioFileName: currentTrack.audioFileName || currentTrack.audioFile?.name,
      vttFileName: currentTrack.vttFileName || currentTrack.vttFile?.name,
      storageMode: currentTrack.storageMode || "browser",
      transcriptionMode: currentTrack.transcriptionMode || "sentence",
      sourceTrackId: sourceId,
    };

    bookmarkPlaylist.tracks.push(newBookmarkTrack);

    await savePlaylist(bookmarkPlaylist);
    await loadLibrary(); // Refresh UI

    // Visual feedback for both buttons
    const buttons = [btnBookmarkMobile, btnBookmarkDesktop];
    buttons.forEach((btn) => {
      (btn as HTMLElement).style.color = "var(--accent-color)";
    });

    setTimeout(() => {
      buttons.forEach((btn) => {
        (btn as HTMLElement).style.color = "";
      });
    }, 500);
  };

  btnBookmarkMobile.addEventListener("click", handleBookmark);
  btnBookmarkDesktop.addEventListener("click", handleBookmark);

  // Settings
  btnSettings.addEventListener("click", () => {
    apiUrlInput.value = ApiClient.getApiUrl() || "";
    settingsModal.classList.remove("hidden");
  });

  btnCloseSettings.addEventListener("click", () => {
    settingsModal.classList.add("hidden");
  });

  btnSaveSettings.addEventListener("click", async () => {
    const url = apiUrlInput.value.trim();
    ApiClient.setApiUrl(url || null);
    settingsModal.classList.add("hidden");
    // Reload library to sync with new API
    await loadLibrary();
    await restorePlaybackState();
    alert(
      url
        ? "Settings saved! Data will now sync to the external database."
        : "Settings saved! Using local storage only.",
    );
  });

  // Modal
  btnNewFolder.addEventListener("click", () => {
    (document.querySelector(".upload-areas") as HTMLElement).style.display =
      "flex";
    (document.querySelector(".pairing-section") as HTMLElement).style.display =
      "block";
    (document.querySelector(".modal-footer") as HTMLElement).style.display =
      "flex";
    openUploadModal("new");
  });

  btnAddTrack.addEventListener("click", () => {
    (document.querySelector(".upload-areas") as HTMLElement).style.display =
      "flex";
    (document.querySelector(".pairing-section") as HTMLElement).style.display =
      "block";
    (document.querySelector(".modal-footer") as HTMLElement).style.display =
      "flex";
    openUploadModal(null);
  });

  btnCloseModal.addEventListener("click", () =>
    uploadModal.classList.add("hidden"),
  );

  // Drag and drop unified
  filesDropzone.addEventListener("click", () => filesUploadInput.click());

  const handleFiles = (files: File[]) => {
    files.forEach((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "vtt") {
        tempVttFiles.push(file);
      } else if (["mp3", "wav", "ogg", "m4a", "aac"].includes(ext || "")) {
        tempAudioFiles.push(file);
      }
    });
    renderPairingList();
  };

  filesUploadInput.addEventListener("change", (e) => {
    const files = Array.from((e.target as HTMLInputElement).files || []);
    handleFiles(files);
  });

  filesDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    filesDropzone.classList.add("dragover");
  });

  filesDropzone.addEventListener("dragleave", () => {
    filesDropzone.classList.remove("dragover");
  });

  filesDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    filesDropzone.classList.remove("dragover");
    const files = Array.from(e.dataTransfer?.files || []);
    handleFiles(files);
  });

  btnSavePlaylist.addEventListener("click", async () => {
    if (editingPlaylistId) {
      const playlist = currentPlaylists.find((p) => p.id === editingPlaylistId);
      if (playlist) {
        playlist.name = playlistNameInput.value.trim() || playlist.name;
        await savePlaylist(playlist);
        await loadLibrary();
      }
      uploadModal.classList.add("hidden");
      return;
    }

    if (editingTrack) {
      const { track, playlist } = editingTrack;
      track.name = playlistNameInput.value.trim() || track.name;
      if (playlist) {
        await savePlaylist(playlist);
      } else {
        await saveStandaloneTrack(track);
      }
      await loadLibrary();
      editingTrack = null;
      uploadModal.classList.add("hidden");
      return;
    }

    if (tempAudioFiles.length === 0 && uploadTargetFolderId !== "new") {
      alert("Please upload at least one audio file.");
      return;
    }

    const isDeviceMode = (
      document.getElementById("toggle-storage-mode") as HTMLInputElement
    ).checked;
    const storageMode = isDeviceMode ? "device" : "browser";
    const transcriptionMode = (
      document.getElementById("transcription-mode") as HTMLSelectElement
    ).value as "sentence" | "word";

    const newTracks: AudioTrack[] = [];
    const pairingItems = pairingListEl.querySelectorAll(".pairing-item");
    pairingItems.forEach((item, index) => {
      const audioFile = tempAudioFiles[index];
      const select = item.querySelector("select") as HTMLSelectElement;
      let vttFile: (File | { name: string; isMissing: true }) | undefined =
        undefined;
      if (select.value !== "none") {
        const vttIndex = parseInt(select.value, 10);
        vttFile = tempVttFiles[vttIndex];
      }

      newTracks.push({
        id: `track-${Date.now()}-${index}`,
        name: audioFile.name.replace(/\.[^/.]+$/, ""),
        audioFile: audioFile instanceof File ? audioFile : null,
        vttFile: vttFile instanceof File ? vttFile : null,
        audioFileName: audioFile.name,
        vttFileName: vttFile ? vttFile.name : undefined,
        storageMode,
        transcriptionMode,
      });
    });

    if (uploadTargetFolderId === "new") {
      const name =
        playlistNameInput.value.trim() ||
        `New Playlist ${currentPlaylists.length + 1}`;
      const newPlaylist: Playlist = {
        id: Date.now().toString(),
        name,
        tracks: newTracks,
      };
      await savePlaylist(newPlaylist);
    } else if (uploadTargetFolderId) {
      const playlist = currentPlaylists.find(
        (p) => p.id === uploadTargetFolderId,
      );
      if (playlist) {
        playlist.tracks.push(...newTracks);
        await savePlaylist(playlist);
      }
    } else {
      // Standalone tracks
      for (const track of newTracks) {
        await saveStandaloneTrack(track);
      }
    }

    // Populate session cache so user can play immediately without re-locating
    newTracks.forEach((track) => {
      if (track.audioFile instanceof File) {
        sessionFileCache.set(track.audioFileName!, track.audioFile);
      }
      if (track.vttFile instanceof File && track.vttFileName) {
        sessionFileCache.set(track.vttFileName, track.vttFile);
      }
    });

    await loadLibrary();
    uploadModal.classList.add("hidden");
  });

  window.addEventListener("beforeunload", () => {
    persistPlaybackState();
  });

  window.addEventListener("pagehide", () => {
    persistPlaybackState();
  });
}

function renderPairingList() {
  pairingListEl.innerHTML = "";
  if (tempAudioFiles.length === 0) {
    pairingListEl.innerHTML =
      '<p class="text-small">Upload audio files first.</p>';
    return;
  }

  tempAudioFiles.forEach((audio) => {
    const div = document.createElement("div");
    div.className = "pairing-item";

    const span = document.createElement("span");
    span.textContent = audio.name;

    const select = document.createElement("select");
    let autoMatchedIndex = -1;

    const noOption = document.createElement("option");
    noOption.value = "none";
    noOption.textContent = "-- No Subtitles --";
    select.appendChild(noOption);

    const audioBaseName = audio.name.replace(/\.[^/.]+$/, "");

    tempVttFiles.forEach((vtt, vIndex) => {
      const opt = document.createElement("option");
      opt.value = vIndex.toString();
      opt.textContent = vtt.name;
      select.appendChild(opt);

      // Auto-pairing logic
      const vttBaseName = vtt.name.replace(/\.[^/.]+$/, "");
      if (audioBaseName === vttBaseName) {
        autoMatchedIndex = vIndex;
      }
    });

    if (autoMatchedIndex !== -1) {
      select.value = autoMatchedIndex.toString();
    } else {
      select.value = "none";
    }

    div.appendChild(span);
    div.appendChild(select);
    pairingListEl.appendChild(div);
  });
}

// Start
init();

// Mobile scroll-to-hide header logic
const mainContent = document.querySelector(".main-content")!;
const topHeader = document.querySelector(".top-header")!;
let lastScrollTop = 0;

mainContent.addEventListener("scroll", () => {
  const st = (mainContent as HTMLElement).scrollTop;
  if (window.innerWidth <= 768) {
    // Hide header on scroll down, show on scroll up
    if (st > lastScrollTop && st > 60) {
      topHeader.classList.add("hidden");
    } else {
      topHeader.classList.remove("hidden");
    }
  }
  lastScrollTop = st;
});
