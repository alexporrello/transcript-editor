import { Component, OnInit, output, signal, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { TapeService } from '../../services/tape.service';
import { PlayerStateService } from '../../services/player-state.service';
import { Speaker } from '@internal/types';

@Component({
    selector: 'app-speaker-list',
    standalone: true,
    imports: [
        CommonModule,
        MatListModule,
        MatIcon,
        MatProgressSpinnerModule
    ],
    templateUrl: './speaker-list.html',
    styleUrl: './speaker-list.scss'
})
export class SpeakerListComponent implements OnInit {
    public readonly speakers = signal<Speaker[]>([]);
    public readonly loading = signal(true);
    public readonly selectedId = signal<string | null>(null);

    public readonly opened = model<boolean>(true);

    constructor(
        private tapeService: TapeService,
        private playerState: PlayerStateService,
        private router: Router,
    ) {}

    ngOnInit() {
        this.tapeService.getSpeakers().subscribe({
            next: (s) => {
                this.speakers.set(s);
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
            }
        });

        this.playerState.selectedSpeaker$.subscribe((id) =>
            this.selectedId.set(id)
        );
    }

    select(speaker: Speaker) {
        this.router.navigate(['/speakers', speaker.id]);
    }
}
