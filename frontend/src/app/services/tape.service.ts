import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Speaker, Tape, SearchResult } from '@internal/types';

@Injectable({ providedIn: 'root' })
export class TapeService {
    constructor(private http: HttpClient) {}

    getSpeakers(): Observable<Speaker[]> {
        return this.http.get<Speaker[]>('/api/speakers');
    }

    getTapes(speakerId: string): Observable<Tape[]> {
        return this.http.get<Tape[]>(`/api/speakers/${speakerId}/tapes`);
    }

    getTranscript(speakerId: string, filename: string): Observable<string> {
        return this.http.get(
            `/api/speakers/${speakerId}/transcript/${filename}`,
            {
                responseType: 'text'
            }
        );
    }

    getAudioUrl(speakerId: string, filename: string): string {
        return `/api/speakers/${speakerId}/audio/${filename}`;
    }

    saveTranscript(speakerId: string, filename: string, content: string): Observable<void> {
        return this.http.put<void>(
            `/api/speakers/${speakerId}/transcript/${filename}`,
            { content }
        );
    }

    searchTranscripts(
        speakerId: string,
        query: string
    ): Observable<SearchResult[]> {
        const params = new URLSearchParams({ q: query }).toString();
        return this.http.get<SearchResult[]>(
            `/api/speakers/${speakerId}/search?${params}`
        );
    }

    getFavorites(speakerId: string): Observable<string[]> {
        return this.http.get<string[]>(`/api/speakers/${speakerId}/favorites`);
    }

    saveFavorites(speakerId: string, favorites: string[]): Observable<void> {
        return this.http.put<void>(
            `/api/speakers/${speakerId}/favorites`,
            { favorites }
        );
    }
}
