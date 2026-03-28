import {
    Component,
    OnInit,
    OnDestroy,
    HostListener,
    computed,
    signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, filter, takeUntil } from 'rxjs';

import { PlayerStateService } from '../../services/player-state.service';
import { SearchStateService } from '../../services/search-state.service';
import { TapeService } from '../../services/tape.service';
import { SpeakerListComponent } from '../speaker-list/speaker-list';
import { TapeListComponent } from '../tape-list/tape-list';
import { PlayerComponent } from '../player/player';
import { TranscriptComponent } from '../transcript/transcript';
import { SearchComponent } from '../search/search';
import { CardComponent } from '../card/card';
import { CardHeaderComponent } from '../card/card-header';
import { CardBodyComponent } from '../card/card-body';
import { CardFooterComponent } from '../card/card-footer';
import { Speaker, Tape } from '@internal/types';

@Component({
    selector: 'app-shell',
    standalone: true,
    imports: [
        RouterLink,
        MatIconModule,
        SpeakerListComponent,
        TapeListComponent,
        PlayerComponent,
        TranscriptComponent,
        SearchComponent,
        CardComponent,
        CardHeaderComponent,
        CardBodyComponent,
        CardFooterComponent,
    ],
    templateUrl: './shell.html',
    styleUrl: './shell.scss',
})
export class ShellComponent implements OnInit, OnDestroy {
    readonly selectedTape = signal<Tape | null>(null);
    readonly selectedSpeaker = signal<string | null>(null);

    /** True when the current route is /speakers/:id/search */
    readonly isSearchRoute = signal(false);

    /** The :speakerId segment parsed from the URL. */
    readonly speakerId = signal<string | null>(null);

    /** Initial transcript mode to restore from URL (only 'edit' is persisted). */
    readonly initialEditMode = signal<'edit' | null>(null);
    /** Initial edit textarea scrollTop to restore from URL. */
    readonly initialEditScroll = signal(0);
    /** Initial edit textarea cursor offset to restore from URL. */
    readonly initialEditCursor = signal(0);

    private readonly speakers = signal<Speaker[]>([]);

    /** Display name for the breadcrumb — falls back to capitalised ID while list loads. */
    readonly speakerName = computed(() => {
        const id = this.speakerId();
        if (!id) return '';
        const match = this.speakers().find((s) => s.id === id);
        return match?.name ?? (id.charAt(0).toUpperCase() + id.slice(1));
    });

    private destroy$ = new Subject<void>();

    constructor(
        private playerState: PlayerStateService,
        private searchState: SearchStateService,
        private tapeService: TapeService,
        private router: Router,
    ) {}

    ngOnInit() {
        this.playerState.selectedTape$
            .pipe(takeUntil(this.destroy$))
            .subscribe((t) => this.selectedTape.set(t));

        this.playerState.selectedSpeaker$
            .pipe(takeUntil(this.destroy$))
            .subscribe((id) => this.selectedSpeaker.set(id));

        // Load the speakers list once for breadcrumb name lookup
        this.tapeService.getSpeakers()
            .pipe(takeUntil(this.destroy$))
            .subscribe((s) => this.speakers.set(s));

        // Sync route-derived signals on every navigation (and on initial load)
        this.syncFromUrl(this.router.url);
        this.router.events
            .pipe(
                filter((e): e is NavigationEnd => e instanceof NavigationEnd),
                takeUntil(this.destroy$),
            )
            .subscribe((e) => this.syncFromUrl(e.urlAfterRedirects));
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    // ─── Route helpers ────────────────────────────────────────────────────────

    private syncFromUrl(url: string) {
        const [path, queryString] = url.split('?');
        const params   = new URLSearchParams(queryString ?? '');
        const tape     = params.get('tape') ?? null;

        // Restore edit-mode state from URL params (written back by transcript event handlers).
        this.initialEditMode.set(params.get('mode') === 'edit' ? 'edit' : null);
        this.initialEditScroll.set(parseInt(params.get('scroll') ?? '0', 10) || 0);
        this.initialEditCursor.set(parseInt(params.get('cursor') ?? '0', 10) || 0);

        const searchMatch  = path.match(/^\/speakers\/([^/?#]+)\/search/);
        const speakerMatch = path.match(/^\/speakers\/([^/?#]+)/);

        if (searchMatch) {
            const id = decodeURIComponent(searchMatch[1]);
            this.speakerId.set(id);
            this.isSearchRoute.set(true);
            this.ensureSpeakerSelected(id);
        } else if (speakerMatch) {
            const id = decodeURIComponent(speakerMatch[1]);
            this.speakerId.set(id);
            this.isSearchRoute.set(false);
            this.ensureSpeakerSelected(id);
            if (tape) {
                this.ensureTapeSelected(id, tape);
            } else if (this.playerState.selectedTape) {
                // No tape in URL — clear selection
                this.playerState.setSelectedSpeaker(id);
            }
        } else {
            this.speakerId.set(null);
            this.isSearchRoute.set(false);
        }
    }

    private ensureSpeakerSelected(id: string) {
        if (id !== this.playerState.selectedSpeaker) {
            this.playerState.setSelectedSpeaker(id);
            this.searchState.clearForSpeaker(id);
        }
    }

    private ensureTapeSelected(speakerId: string, filename: string) {
        if (this.playerState.selectedTape?.filename === filename) return;
        this.tapeService.getTapes(speakerId)
            .pipe(takeUntil(this.destroy$))
            .subscribe((tapes) => {
                const tape = tapes.find((t) => t.filename === filename);
                if (tape) this.playerState.setSelectedTape(tape);
            });
    }

    // ─── Search toggle ────────────────────────────────────────────────────────

    toggleSearch() {
        const id = this.speakerId();
        if (!id) return;
        const tape = this.playerState.selectedTape?.filename;
        if (this.isSearchRoute()) {
            // Return to tape view, restoring the selected tape in the URL if present
            this.router.navigate(
                ['/speakers', id],
                tape ? { queryParams: { tape } } : {},
            );
        } else {
            this.router.navigate(['/speakers', id, 'search']);
        }
    }

    // ─── Transcript edit-state URL persistence ────────────────────────────────

    onTranscriptModeChanged(mode: string) {
        if (mode === 'edit') {
            this.updateEditParams({ mode: 'edit' });
        } else {
            // Leaving edit mode — clear all three params
            this.updateEditParams({ mode: null, scroll: null, cursor: null });
        }
    }

    onEditScrollChange(scroll: number) {
        this.updateEditParams({ scroll });
    }

    onEditCursorChange(cursor: number) {
        this.updateEditParams({ cursor });
    }

    private updateEditParams(queryParams: Record<string, string | number | null>) {
        this.router.navigate([], {
            queryParamsHandling: 'merge',
            queryParams,
            replaceUrl: true,
        });
    }

    // ─── Keyboard shortcuts ───────────────────────────────────────────────────

    @HostListener('document:keydown', ['$event'])
    onGlobalKeydown(event: KeyboardEvent) {
        // ⌘⇧F / Ctrl+Shift+F — toggle search
        if (event.shiftKey && event.key === 'F' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            this.toggleSearch();
        }
        // Escape while on search route — go back to tape list
        if (event.key === 'Escape' && this.isSearchRoute()) {
            this.toggleSearch();
        }
        // ⌘⇧→ / Ctrl+Shift+→ — skip forward 10 s
        // ⌘⇧← / Ctrl+Shift+← — skip back 10 s
        if (event.shiftKey && (event.ctrlKey || event.metaKey)) {
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                this.playerState.skip(10);
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                this.playerState.skip(-10);
            }
        }
    }
}
