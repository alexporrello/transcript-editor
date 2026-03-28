import { Injectable, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

import { TapeService } from './tape.service';
import { PlayerStateService } from './player-state.service';

@Injectable({ providedIn: 'root' })
export class FavoritesService {
    private readonly favorites = signal<Set<string>>(new Set());

    /** Read-only view of the current speaker's favorited filenames. */
    readonly favorites$ = computed(() => this.favorites());

    constructor(
        private readonly tapeService: TapeService,
        private readonly playerState: PlayerStateService,
    ) {
        // Reload favorites whenever the active speaker changes.
        this.playerState.selectedSpeaker$
            .pipe(
                filter((id): id is string => !!id),
                takeUntilDestroyed(),
            )
            .subscribe((speakerId) => {
                this.tapeService.getFavorites(speakerId).subscribe({
                    next: (filenames) => this.favorites.set(new Set(filenames)),
                    error: () => this.favorites.set(new Set()),
                });
            });
    }

    isFavorite(filename: string): boolean {
        return this.favorites().has(filename);
    }

    toggleFavorite(speakerId: string, filename: string): void {
        const current = new Set(this.favorites());
        if (current.has(filename)) {
            current.delete(filename);
        } else {
            current.add(filename);
        }
        // Optimistically update the signal, then persist.
        this.favorites.set(current);
        this.tapeService.saveFavorites(speakerId, Array.from(current)).subscribe({
            error: () => {
                // Roll back on failure.
                const rolled = new Set(current);
                if (rolled.has(filename)) {
                    rolled.delete(filename);
                } else {
                    rolled.add(filename);
                }
                this.favorites.set(rolled);
            },
        });
    }
}
