import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SearchResult } from '@internal/types';

/**
 * Singleton service that holds search state across route transitions.
 * The SearchComponent reads from and writes to this service so that
 * navigating away from /search and back restores the previous query + results.
 */
@Injectable({ providedIn: 'root' })
export class SearchStateService {
    private querySubject = new BehaviorSubject<string>('');
    private resultsSubject = new BehaviorSubject<SearchResult[]>([]);
    private loadingSubject = new BehaviorSubject<boolean>(false);
    private searchPerformedSubject = new BehaviorSubject<boolean>(false);

    /** The current speaker whose transcripts are being searched. */
    private activeSpeakerId: string | null = null;

    query$ = this.querySubject.asObservable();
    results$ = this.resultsSubject.asObservable();
    loading$ = this.loadingSubject.asObservable();
    searchPerformed$ = this.searchPerformedSubject.asObservable();

    get query(): string { return this.querySubject.value; }
    get results(): SearchResult[] { return this.resultsSubject.value; }
    get loading(): boolean { return this.loadingSubject.value; }
    get searchPerformed(): boolean { return this.searchPerformedSubject.value; }

    setQuery(q: string): void { this.querySubject.next(q); }
    setResults(r: SearchResult[]): void { this.resultsSubject.next(r); }
    setLoading(v: boolean): void { this.loadingSubject.next(v); }
    setSearchPerformed(v: boolean): void { this.searchPerformedSubject.next(v); }

    /**
     * Call when the active speaker changes so stale results are cleared.
     */
    clearForSpeaker(speakerId: string): void {
        if (speakerId !== this.activeSpeakerId) {
            this.activeSpeakerId = speakerId;
            this.querySubject.next('');
            this.resultsSubject.next([]);
            this.loadingSubject.next(false);
            this.searchPerformedSubject.next(false);
        }
    }
}
