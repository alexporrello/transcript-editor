import {
    Component,
    AfterViewInit,
    OnChanges,
    OnDestroy,
    ViewChild,
    ElementRef,
    Input,
    SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';

import { PlayerStateService } from '../../services/player-state.service';
import { TapeService } from '../../services/tape.service';
import { Tape } from '@internal/types';

@Component({
    selector: 'app-player',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './player.html',
    styleUrl: './player.scss'
})
export class PlayerComponent implements AfterViewInit, OnChanges, OnDestroy {
    @Input() tape!: Tape;
    @Input() speakerId!: string;
    @ViewChild('audioEl') audioElRef!: ElementRef<HTMLAudioElement>;

    private destroy$ = new Subject<void>();

    constructor(
        private playerState: PlayerStateService,
        private tapeService: TapeService
    ) {}

    ngAfterViewInit() {
        // Register with the service so the transcript component can sync via currentTime$
        this.playerState.registerAudioElement(this.audioElRef.nativeElement);
        this.loadTape();
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes['tape'] && !changes['tape'].firstChange) {
            this.loadTape();
        }
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    private loadTape() {
        const audio = this.audioElRef?.nativeElement;
        if (!audio || !this.tape || !this.speakerId) return;
        audio.src = this.tapeService.getAudioUrl(
            this.speakerId,
            this.tape.filename
        );
        audio.load();
        // audio.play().catch(() => { /* autoplay blocked — user can press play */ });
    }

}
