import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Tape } from '@internal/types';

@Injectable({ providedIn: 'root' })
export class PlayerStateService {
    private selectedSpeakerSubject = new BehaviorSubject<string | null>(null);
    private selectedTapeSubject = new BehaviorSubject<Tape | null>(null);
    private currentTimeSubject = new BehaviorSubject<number>(0);
    private durationSubject = new BehaviorSubject<number>(0);
    private isPlayingSubject = new BehaviorSubject<boolean>(false);

    selectedSpeaker$ = this.selectedSpeakerSubject.asObservable();
    selectedTape$ = this.selectedTapeSubject.asObservable();
    currentTime$ = this.currentTimeSubject.asObservable();
    duration$ = this.durationSubject.asObservable();
    isPlaying$ = this.isPlayingSubject.asObservable();

    private audioEl: HTMLAudioElement | null = null;
    private pendingSeekTime: number | null = null;

    // ─── Speaker / Tape selection ───────────────────────────────────────────

    setSelectedSpeaker(speakerId: string) {
        this.selectedSpeakerSubject.next(speakerId);
        this.selectedTapeSubject.next(null);
        this.stopAndReset();
    }

    setSelectedTape(tape: Tape) {
        this.selectedTapeSubject.next(tape);
    }

    get selectedSpeaker(): string | null {
        return this.selectedSpeakerSubject.value;
    }

    get selectedTape(): Tape | null {
        return this.selectedTapeSubject.value;
    }

    // ─── Audio element registration ─────────────────────────────────────────

    registerAudioElement(el: HTMLAudioElement) {
        this.audioEl = el;

        el.addEventListener('timeupdate', () =>
            this.currentTimeSubject.next(el.currentTime)
        );
        el.addEventListener('durationchange', () =>
            this.durationSubject.next(el.duration || 0)
        );
        el.addEventListener('play', () => this.isPlayingSubject.next(true));
        el.addEventListener('pause', () => this.isPlayingSubject.next(false));
        el.addEventListener('ended', () => this.isPlayingSubject.next(false));
        el.addEventListener('loadedmetadata', () => {
            if (this.pendingSeekTime !== null) {
                el.currentTime = Math.max(0, this.pendingSeekTime);
                this.pendingSeekTime = null;
            }
        });
    }

    /**
     * Seeks to the given time once the audio metadata is loaded.
     * Useful when selecting a new tape and needing to jump to a specific time.
     */
    seekWhenReady(time: number) {
        this.pendingSeekTime = time;
        // If already loaded, seek immediately
        if (this.audioEl && this.audioEl.readyState >= 1) {
            this.audioEl.currentTime = Math.max(0, time);
            this.pendingSeekTime = null;
        }
    }

    // ─── Playback controls ───────────────────────────────────────────────────

    togglePlayPause() {
        if (!this.audioEl) return;
        this.audioEl.paused ? this.audioEl.play() : this.audioEl.pause();
    }

    seek(time: number) {
        if (this.audioEl) {
            this.audioEl.currentTime = Math.max(0, time);
        }
    }

    skip(seconds: number) {
        if (this.audioEl) {
            this.audioEl.currentTime = Math.max(
                0,
                this.audioEl.currentTime + seconds
            );
        }
    }

    get currentTime(): number {
        return this.currentTimeSubject.value;
    }

    get duration(): number {
        return this.durationSubject.value;
    }

    private stopAndReset() {
        if (this.audioEl) {
            this.audioEl.pause();
            this.audioEl.currentTime = 0;
        }
        this.isPlayingSubject.next(false);
        this.currentTimeSubject.next(0);
        this.durationSubject.next(0);
    }
}
