import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatNavList } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconButton } from '@angular/material/button';
import { Router } from '@angular/router';
import { Subject, switchMap, filter, takeUntil } from 'rxjs';

import { TapeService } from '../../services/tape.service';
import { PlayerStateService } from '../../services/player-state.service';
import { FavoritesService } from '../../services/favorites.service';
import { Tape } from '@internal/types';
import { TapeComponent } from '../tape/tape';

@Component({
    selector: 'app-tape-list',
    standalone: true,
    imports: [
        CommonModule,
        MatNavList,
        MatIconModule,
        MatTooltipModule,
        MatProgressSpinnerModule,
        MatIconButton,
        TapeComponent
    ],
    templateUrl: './tape-list.html',
    styleUrl: './tape-list.scss'
})
export class TapeListComponent implements OnInit, OnDestroy {
    tapes = signal<Tape[]>([]);
    loading = signal(false);
    selectedTape = signal<Tape | null>(null);
    selectedSpeaker = signal<string | null>(null);
    showFavoritesOnly = signal(false);
    private destroy$ = new Subject<void>();

    readonly displayedTapes = computed(() => {
        const all = this.tapes();
        if (!this.showFavoritesOnly()) return all;
        return all.filter(t => this.favoritesService.isFavorite(t.filename));
    });

    readonly hasFavorites = computed(() =>
        this.tapes().some(t => this.favoritesService.isFavorite(t.filename))
    );

    constructor(
        private tapeService: TapeService,
        private playerState: PlayerStateService,
        private router: Router,
        readonly favoritesService: FavoritesService,
    ) {}

    ngOnInit() {
        this.playerState.selectedTape$
            .pipe(takeUntil(this.destroy$))
            .subscribe((tape) => this.selectedTape.set(tape));

        this.playerState.selectedSpeaker$
            .pipe(
                takeUntil(this.destroy$),
                filter((id) => !!id),
                switchMap((id) => {
                    this.selectedSpeaker.set(id);
                    this.tapes.set([]);
                    this.loading.set(true);
                    this.showFavoritesOnly.set(false);
                    return this.tapeService.getTapes(id!);
                })
            )
            .subscribe({
                next: (tapes) => {
                    this.tapes.set(tapes);
                    this.loading.set(false);
                },
                error: () => {
                    this.loading.set(false);
                }
            });
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    selectTape(tape: Tape) {
        const speakerId = this.selectedSpeaker();
        if (speakerId) {
            this.router.navigate(['/speakers', speakerId], { queryParams: { tape: tape.filename } });
        }
    }

    isSelected(tape: Tape): boolean {
        return this.selectedTape()?.filename === tape.filename;
    }

    onToggleFavorite(tape: Tape): void {
        const speakerId = this.selectedSpeaker();
        if (speakerId) {
            this.favoritesService.toggleFavorite(speakerId, tape.filename);
        }
    }
}
