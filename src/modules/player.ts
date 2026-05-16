export class AudioPlayer {
  private audio: HTMLAudioElement;
  private onTimeUpdate: (currentTime: number, duration: number) => void;
  private onEnded: () => void;
  private currentObjectUrl: string | null = null;

  constructor(
    onTimeUpdate: (currentTime: number, duration: number) => void,
    onEnded: () => void
  ) {
    this.audio = new Audio();
    this.onTimeUpdate = onTimeUpdate;
    this.onEnded = onEnded;

    this.audio.addEventListener('timeupdate', () => {
      this.onTimeUpdate(this.audio.currentTime, this.audio.duration || 0);
    });

    this.audio.addEventListener('ended', () => {
      this.onEnded();
    });
    
    // Setup loadedmetadata listener specifically for seeking on load
    this.audio.addEventListener('loadedmetadata', () => {
       if (this.pendingStartTime !== null) {
         this.audio.currentTime = this.pendingStartTime;
         this.pendingStartTime = null;
       }
    });
  }

  private pendingStartTime: number | null = null;

  public loadTrack(file: File, autoPlay = true, startTime?: number) {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
    }
    this.currentObjectUrl = URL.createObjectURL(file);
    this.audio.src = this.currentObjectUrl;
    
    if (startTime !== undefined && startTime > 0) {
      this.pendingStartTime = startTime;
    } else {
      this.pendingStartTime = null;
    }
    
    this.audio.load();
    if (autoPlay) {
      this.play();
    }
  }

  public play() {
    this.audio.play().catch(e => console.error("Playback failed:", e));
  }

  public pause() {
    this.audio.pause();
  }

  public togglePlay() {
    if (this.audio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  public isPlaying(): boolean {
    return !this.audio.paused;
  }

  public seek(time: number) {
    if (time >= 0 && time <= (this.audio.duration || 0)) {
      this.audio.currentTime = time;
    }
  }

  public jump(seconds: number) {
    this.seek(this.audio.currentTime + seconds);
  }

  public setSpeed(speed: number) {
    this.audio.playbackRate = speed;
  }

  public toggleLoop() {
    this.audio.loop = !this.audio.loop;
    return this.audio.loop;
  }

  public setVolume(volume: number) {
    this.audio.volume = volume;
  }

  public get duration(): number {
    return this.audio.duration || 0;
  }

  public get currentTime(): number {
    return this.audio.currentTime || 0;
  }
}
