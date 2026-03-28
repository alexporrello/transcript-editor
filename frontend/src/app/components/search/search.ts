import {
    Component,
    OnInit,
    OnDestroy,
    AfterViewInit,
    ViewChild,
    ElementRef,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRippleModule } from '@angular/material/core';
import { Router } from '@angular/router';
import { Subject, EMPTY } from 'rxjs';
import {
    debounceTime,
    distinctUntilChanged,
    switchMap,
    takeUntil,
} from 'rxjs/operators';

import { TapeService } from '../../services/tape.service';
import { PlayerStateService } from '../../services/player-state.service';
import { SearchStateService } from '../../services/search-state.service';
import { SearchMatch, Tape } from '@internal/types';

@Component({
    selector: 'app-search',
    standalone: true,
    imports: [
        CommonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatRippleModule,
    ],
    templateUrl: './search.html',
    styleUrl: './search.scss',
})
export class SearchComponent implements OnInit, AfterViewInit, OnDestroy {
    @ViewChild('searchInput') searchInputEl!: ElementRef<HTMLInputElement>;

    /** Signal views of the persisted search state — reactive in templates. */
    readonly query = toSignal(this.searchState.query$, { initialValue: '' });
    readonly results = toSignal(this.searchState.results$, { initialValue: [] });
    readonly loading = toSignal(this.searchState.loading$, { initialValue: false });
    readonly searchPerformed = toSignal(this.searchState.searchPerformed$, { initialValue: false });

    private readonly inputSubject = new Subject<string>();
    private destroy$ = new Subject<void>();

    // toSignal() calls above require an injection context — keep constructor injection
    constructor(
        private tapeService: TapeService,
        private playerState: PlayerStateService,
        private searchState: SearchStateService,
        private router: Router,
    ) {}

    ngOnInit() {
        this.inputSubject
            .pipe(
                debounceTime(250),
                distinctUntilChanged(),
                takeUntil(this.destroy$),
                switchMap((q) => {
                    const trimmed = q.trim();
                    if (!trimmed) {
                        this.searchState.setResults([]);
                        this.searchState.setSearchPerformed(false);
                        this.searchState.setLoading(false);
                        return EMPTY;
                    }
                    this.searchState.setLoading(true);
                    this.searchState.setSearchPerformed(true);
                    const speakerId = this.playerState.selectedSpeaker;
                    if (!speakerId) return EMPTY;
                    return this.tapeService.searchTranscripts(speakerId, trimmed);
                }),
            )
            .subscribe({
                next: (results) => {
                    this.searchState.setResults(results);
                    this.searchState.setLoading(false);
                },
                error: () => {
                    this.searchState.setLoading(false);
                },
            });

        // Re-run a previous query if the component was destroyed and re-created
        if (this.searchState.query) {
            this.inputSubject.next(this.searchState.query);
        }
    }

    ngAfterViewInit() {
        setTimeout(() => this.searchInputEl?.nativeElement.focus(), 50);
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    // ─── Input handling ───────────────────────────────────────────────────────

    onInput(event: Event) {
        const value = (event.target as HTMLInputElement).value;
        this.searchState.setQuery(value);
        this.inputSubject.next(value);
    }

    clearQuery() {
        this.searchState.setQuery('');
        this.searchState.setResults([]);
        this.searchState.setSearchPerformed(false);
        this.inputSubject.next('');
        this.searchInputEl?.nativeElement.focus();
    }

    onKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            this.closeSearch();
        }
    }

    closeSearch() {
        const speakerId = this.playerState.selectedSpeaker;
        if (speakerId) {
            this.router.navigate(['/speakers', speakerId]);
        } else {
            this.router.navigate(['/']);
        }
    }

    // ─── Result interaction ───────────────────────────────────────────────────

    selectMatch(tape: Tape, match: SearchMatch) {
        // Store the pending seek before navigating — the shell will set the tape
        // via ensureTapeSelected, which triggers audio load, which applies the seek.
        this.playerState.seekWhenReady(match.startTime);
        const speakerId = this.playerState.selectedSpeaker;
        if (speakerId) {
            this.router.navigate(['/speakers', speakerId], { queryParams: { tape: tape.filename } });
        }
    }

    // ─── Display helpers ──────────────────────────────────────────────────────

    tapeLabel(tape: Tape): string {
        const parts: string[] = [];
        if (tape.event?.trim()) parts.push(tape.event.trim());
        if (tape.title?.trim() && tape.title.trim() !== tape.event?.trim()) {
            parts.push(tape.title.trim());
        }
        if (parts.length === 0) {
            parts.push(tape.text?.trim() || tape._text?.trim() || 'Untitled');
        }
        return parts.join(' — ');
    }

    tapeDate(tape: Tape): string {
        const date = tape.date;
        if (!date) return '';
        try {
            const [year, month] = date.split('-');
            const months = [
                'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
            ];
            return `${months[parseInt(month, 10) - 1]} ${year}`;
        } catch {
            return date;
        }
    }

    formatTime(seconds: number): string {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    highlightMatch(text: string, rawQuery: string): string {
        const q = rawQuery.trim();
        if (!q) return this.escapeHtml(text);

        const qLower = q.toLowerCase();
        const tLower = text.toLowerCase();
        const parts: string[] = [];
        let cursor = 0;

        while (cursor < text.length) {
            const idx = tLower.indexOf(qLower, cursor);
            if (idx === -1) {
                parts.push(this.escapeHtml(text.slice(cursor)));
                break;
            }
            if (idx > cursor) parts.push(this.escapeHtml(text.slice(cursor, idx)));
            parts.push(`<mark>${this.escapeHtml(text.slice(idx, idx + q.length))}</mark>`);
            cursor = idx + q.length;
        }

        return parts.join('');
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    get totalMatchCount(): number {
        return this.results().reduce((sum, r) => sum + r.matches.length, 0);
    }

    get speakerSelected(): boolean {
        return !!this.playerState.selectedSpeaker;
    }
}
