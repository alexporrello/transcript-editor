import {
    Component,
    OnInit,
    OnDestroy,
    OnChanges,
    Input,
    Output,
    EventEmitter,
    SimpleChanges,
    ViewChild,
    ElementRef,
    ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { TapeService } from '../../services/tape.service';
import { PlayerStateService } from '../../services/player-state.service';
import { CardHeaderComponent } from '../card/card-header';
import { Tape, SrtSegment } from '@internal/types';

/** The three transcript viewing modes. */
type TranscriptMode = 'timed' | 'read' | 'edit';

/**
 * A group of one or more consecutive SRT segments rendered as a single
 * paragraph in Read mode. Segments with no blank line between them in the
 * raw SRT are merged; a blank line creates a paragraph break.
 */
interface ReadParagraph {
    startTime: number;
    endTime: number;
    text: string;
    /** Index into srtSegments[] of the first segment in this paragraph. */
    firstSegmentArrayIndex: number;
    /** Index into srtSegments[] of the last segment in this paragraph. */
    lastSegmentArrayIndex: number;
}

@Component({
    selector: 'app-transcript',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonToggleModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatButtonModule,
        MatTooltipModule,
        CardHeaderComponent,
    ],
    templateUrl: './transcript.html',
    styleUrl: './transcript.scss'
})
export class TranscriptComponent implements OnInit, OnDestroy, OnChanges {
    @Input() tape!: Tape;
    @Input() speakerId!: string;
    /** Restore edit mode on load when set to 'edit'. */
    @Input() initialMode: TranscriptMode | null = null;
    /** Restore textarea scrollTop on load. Only applied when initialMode is 'edit'. */
    @Input() initialEditScroll = 0;
    /** Restore textarea cursor offset on load. Only applied when initialMode is 'edit'. */
    @Input() initialEditCursor = 0;

    /** Emits the new mode whenever the user switches modes. */
    @Output() modeChanged = new EventEmitter<TranscriptMode>();
    /** Emits the textarea scrollTop whenever the edit textarea is scrolled. */
    @Output() editScrollChange = new EventEmitter<number>();
    /** Emits the cursor offset (selectionStart) whenever the edit textarea is clicked. */
    @Output() editCursorChange = new EventEmitter<number>();
    @ViewChild('timedContainer') timedContainer!: ElementRef<HTMLElement>;
    @ViewChild('readContainer') readContainer!: ElementRef<HTMLElement>;
    @ViewChild('editTextarea') editTextarea!: ElementRef<HTMLTextAreaElement>;

    mode: TranscriptMode = 'timed';
    srtSegments: SrtSegment[] = [];
    readParagraphs: ReadParagraph[] = [];
    rawSrtContent = '';
    editContent = '';
    editDirty = false;
    saving = false;
    saveError = '';
    saveSuccess = false;
    loading = false;
    error = '';
    activeSegmentIndex = -1;
    activeParagraphIndex = -1;

    private destroy$ = new Subject<void>();
    private lastScrolledIndex = -1;
    private scrollAnchorIndex = -1;
    private savedEditScrollTop = 0;
    /** Start time of the last SRT block seeked from edit-mode click. Null after
     *  an external seek (timed/read/search) or a new tape load, so the next
     *  edit click always seeks even if the parsed time happens to match. */
    private lastEditSeekTime: number | null = null;

    constructor(
        private tapeService: TapeService,
        private playerState: PlayerStateService,
        private cdr: ChangeDetectorRef
    ) {}

    ngOnInit() {
        this.playerState.currentTime$
            .pipe(takeUntil(this.destroy$))
            .subscribe((time) => this.updateActiveSegment(time));
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes['tape'] && this.tape) {
            this.loadTranscripts();
        }
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    // ─── Loading ─────────────────────────────────────────────────────────────

    private loadTranscripts() {
        this.srtSegments = [];
        this.readParagraphs = [];
        this.rawSrtContent = '';
        this.editContent = '';
        this.editDirty = false;
        this.saveError = '';
        this.saveSuccess = false;
        this.activeSegmentIndex = -1;
        this.activeParagraphIndex = -1;
        this.lastScrolledIndex = -1;
        this.savedEditScrollTop = 0;
        this.lastEditSeekTime = null;
        this.error = '';

        if (this.tape.hasSrt) {
            this.mode = this.initialMode ?? 'timed';
            this.loadSrt();
        } else if (this.tape.hasTxt) {
            this.mode = 'read';
            this.loadTxt();
        }
    }

    private loadSrt() {
        this.loading = true;
        const filename = `${this.tape.filename}.srt`;
        this.tapeService
            .getTranscript(this.speakerId, filename)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: (content) => {
                    this.rawSrtContent = content;
                    this.editContent = content;
                    this.applyParsedSrt(content);
                    this.loading = false;
                    this.cdr.markForCheck();
                    if (this.mode === 'edit') {
                        setTimeout(() => this.restoreEditPosition(), 50);
                    }
                },
                error: () => {
                    this.error = 'Could not load SRT.';
                    this.loading = false;
                }
            });
    }

    private loadTxt() {
        this.loading = true;
        const filename = `${this.tape.filename}.txt`;
        this.tapeService
            .getTranscript(this.speakerId, filename)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: (content) => {
                    this.rawSrtContent = content;
                    this.editContent = content;
                    this.loading = false;
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.error = 'Could not load transcript.';
                    this.loading = false;
                }
            });
    }

    /** Parses SRT content and populates both srtSegments and readParagraphs. */
    private applyParsedSrt(content: string) {
        const { segments, paragraphs } = this.parseSrtWithParagraphs(content);
        this.srtSegments = segments;
        this.readParagraphs = paragraphs;
    }

    // ─── SRT parsing ─────────────────────────────────────────────────────────

    /**
     * Parses raw SRT content into flat segments (for Timed / Edit mode) and
     * grouped paragraphs (for Read mode).
     *
     * Paragraph convention: a blank line between two consecutive blocks is a
     * paragraph break. No blank line between blocks merges them into one paragraph.
     */
    private parseSrtWithParagraphs(content: string): {
        segments: SrtSegment[];
        paragraphs: ReadParagraph[];
    } {
        const segments: SrtSegment[] = [];
        const paragraphs: ReadParagraph[] = [];
        const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = normalized.split('\n');

        let i = 0;

        // Accumulates segments for the current paragraph-in-progress
        let paraSegs: { seg: SrtSegment; arrayIdx: number }[] = [];

        const flushParagraph = () => {
            if (!paraSegs.length) return;
            paragraphs.push({
                startTime: paraSegs[0].seg.startTime,
                endTime: paraSegs[paraSegs.length - 1].seg.endTime,
                text: paraSegs.map((s) => s.seg.text).join(' '),
                firstSegmentArrayIndex: paraSegs[0].arrayIdx,
                lastSegmentArrayIndex: paraSegs[paraSegs.length - 1].arrayIdx
            });
            paraSegs = [];
        };

        while (i < lines.length) {
            // Count blank lines before the next non-empty content
            let blanksBefore = 0;
            while (i < lines.length && lines[i].trim() === '') {
                blanksBefore++;
                i++;
            }
            if (i >= lines.length) break;

            // Expect a pure-integer index line
            const indexLine = lines[i].trim();
            if (!/^\d+$/.test(indexLine)) {
                i++;
                continue;
            }

            // Expect a timestamp on the very next line
            if (i + 1 >= lines.length) break;
            const timeLine = lines[i + 1].trim();
            const timeMatch = timeLine.match(
                /(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/
            );
            if (!timeMatch) {
                i++;
                continue;
            }

            i += 2; // consume index + timestamp lines

            // Collect text lines until a blank line OR the start of the next block
            const textLines: string[] = [];
            while (i < lines.length) {
                const line = lines[i];
                if (line.trim() === '') break; // blank line → end of this block

                // Lookahead: pure-integer line + timestamp on the line after = next block
                const looksLikeIndex = /^\d+$/.test(line.trim());
                const nextIsTimestamp =
                    i + 1 < lines.length &&
                    /^\d{2}:\d{2}:\d{2}[,\.]/.test(lines[i + 1].trim());
                if (looksLikeIndex && nextIsTimestamp) break;

                textLines.push(line);
                i++;
            }

            const text = textLines
                .join(' ')
                .replace(/<[^>]+>/g, '')
                .trim();
            const seg: SrtSegment = {
                index: parseInt(indexLine, 10),
                startTime: this.timeToSeconds(timeMatch[1]),
                endTime: this.timeToSeconds(timeMatch[2]),
                text
            };

            // A blank line before this block = paragraph break
            if (blanksBefore > 0 && paraSegs.length > 0) {
                flushParagraph();
            }

            paraSegs.push({ seg, arrayIdx: segments.length });
            segments.push(seg);
        }

        flushParagraph();
        return { segments, paragraphs };
    }

    private timeToSeconds(timeStr: string): number {
        const normalized = timeStr.replace(',', '.');
        const parts = normalized.split(':');
        return (
            parseInt(parts[0], 10) * 3600 +
            parseInt(parts[1], 10) * 60 +
            parseFloat(parts[2])
        );
    }

    // ─── Active segment / paragraph sync ─────────────────────────────────────

    private updateActiveSegment(currentTime: number) {
        if (!this.srtSegments.length) return;

        // Binary search for the active segment
        let lo = 0,
            hi = this.srtSegments.length - 1,
            found = -1;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const seg = this.srtSegments[mid];
            if (currentTime >= seg.startTime && currentTime <= seg.endTime) {
                found = mid;
                break;
            } else if (currentTime < seg.startTime) {
                hi = mid - 1;
            } else {
                lo = mid + 1;
            }
        }

        // Derive active paragraph from active segment
        const foundParagraph =
            found >= 0
                ? this.readParagraphs.findIndex(
                      (p) =>
                          found >= p.firstSegmentArrayIndex &&
                          found <= p.lastSegmentArrayIndex
                  )
                : -1;

        const segmentChanged = found !== this.activeSegmentIndex;
        const paragraphChanged = foundParagraph !== this.activeParagraphIndex;

        this.activeSegmentIndex = found;
        this.activeParagraphIndex = foundParagraph;

        if (segmentChanged || paragraphChanged) {
            this.cdr.markForCheck();

            if (this.mode !== 'edit') {
                // In Read mode scroll when paragraph changes; in Timed when segment changes
                const scrollIdx = this.mode === 'read' ? foundParagraph : found;
                if (scrollIdx >= 0 && scrollIdx !== this.lastScrolledIndex) {
                    this.lastScrolledIndex = scrollIdx;
                    setTimeout(() => this.scrollToActive(), 50);
                }
            }
        }
    }

    private scrollToActive() {
        const container =
            this.mode === 'read'
                ? this.readContainer?.nativeElement
                : this.timedContainer?.nativeElement;
        if (!container) return;
        const activeEl = container.querySelector('.active') as HTMLElement;
        if (activeEl)
            activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ─── Seek helpers ─────────────────────────────────────────────────────────

    seekToSegment(segment: SrtSegment) {
        this.lastEditSeekTime = null;
        this.playerState.seek(segment.startTime);
    }

    seekToTime(time: number) {
        this.lastEditSeekTime = null;
        this.playerState.seek(time);
    }

    // ─── Edit mode ───────────────────────────────────────────────────────────

    onEditClick() {
        const el = this.editTextarea.nativeElement;
        this.editCursorChange.emit(el.selectionStart);
        const textToCursor = this.editContent.substring(0, el.selectionStart);

        // Walk backwards through all timestamp lines up to the cursor and keep the last one
        const timePattern =
            /(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/g;
        let lastMatch: RegExpExecArray | null = null;
        let match: RegExpExecArray | null;
        while ((match = timePattern.exec(textToCursor)) !== null) {
            lastMatch = match;
        }

        if (lastMatch) {
            const startTime = this.timeToSeconds(lastMatch[1]);
            if (startTime !== this.lastEditSeekTime) {
                this.playerState.seek(startTime);
                this.lastEditSeekTime = startTime;
            }
        }
    }

    onEditScroll() {
        const el = this.editTextarea?.nativeElement;
        if (el) this.editScrollChange.emit(el.scrollTop);
    }

    onEditInput() {
        this.editDirty = true;
        this.saveError = '';
        this.saveSuccess = false;
    }

    onEditKeydown(event: KeyboardEvent) {
        const ctrl = event.ctrlKey || event.metaKey;

        if (ctrl && event.key === 's') {
            event.preventDefault();
            this.saveEdit();
        } else if (ctrl && event.key === 'b') {
            event.preventDefault();
            this.wrapSelection('**', '**');
        } else if (ctrl && event.key === 'i') {
            event.preventDefault();
            this.wrapSelection('*', '*');
        } else if (ctrl && !event.shiftKey && event.key === 'x') {
            const el = this.editTextarea.nativeElement;
            if (el.selectionStart === el.selectionEnd) {
                event.preventDefault();
                this.cutCurrentLine(el);
            }
        }
    }

    private wrapSelection(before: string, after: string) {
        const el = this.editTextarea.nativeElement;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const value = this.editContent;
        const selected = value.substring(start, end);

        if (selected) {
            const isWrapped =
                value.substring(start - before.length, start) === before &&
                value.substring(end, end + after.length) === after;

            if (isWrapped) {
                el.setSelectionRange(start - before.length, end + after.length);
                document.execCommand('insertText', false, selected);
                el.setSelectionRange(
                    start - before.length,
                    end - before.length
                );
            } else {
                el.setSelectionRange(start, end);
                document.execCommand(
                    'insertText',
                    false,
                    before + selected + after
                );
                el.setSelectionRange(
                    start + before.length,
                    end + before.length
                );
            }
        } else {
            document.execCommand('insertText', false, before + after);
            const newPos = start + before.length;
            el.setSelectionRange(newPos, newPos);
        }

        this.syncAfterEdit(el);
    }

    private cutCurrentLine(el: HTMLTextAreaElement) {
        const value = this.editContent;
        const cursor = el.selectionStart;
        const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
        const lineEnd = value.indexOf('\n', cursor);

        let textToCut: string;
        let selectStart: number;
        let selectEnd: number;
        let newCursor: number;

        if (lineEnd === -1) {
            textToCut = value.substring(lineStart);
            selectStart = lineStart > 0 ? lineStart - 1 : 0;
            selectEnd = value.length;
            newCursor = selectStart;
        } else {
            textToCut = value.substring(lineStart, lineEnd);
            selectStart = lineStart;
            selectEnd = lineEnd + 1;
            newCursor = lineStart;
        }

        navigator.clipboard.writeText(textToCut).catch(() => {});
        el.setSelectionRange(selectStart, selectEnd);
        document.execCommand('insertText', false, '');
        el.setSelectionRange(newCursor, newCursor);
        this.syncAfterEdit(el);
    }

    private syncAfterEdit(el: HTMLTextAreaElement) {
        this.editContent = el.value;
        this.editDirty = true;
        this.saveError = '';
        this.saveSuccess = false;
        this.cdr.markForCheck();
    }

    saveEdit() {
        if (!this.editDirty || this.saving) return;

        this.saving = true;
        this.saveError = '';
        this.saveSuccess = false;

        const filename = `${this.tape.filename}.srt`;
        this.tapeService
            .saveTranscript(this.speakerId, filename, this.editContent)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: () => {
                    this.rawSrtContent = this.editContent;
                    this.applyParsedSrt(this.editContent);
                    this.editDirty = false;
                    this.saving = false;
                    this.saveSuccess = true;
                    setTimeout(() => {
                        this.saveSuccess = false;
                        this.cdr.markForCheck();
                    }, 2500);
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.saveError = 'Save failed. Please try again.';
                    this.saving = false;
                    this.cdr.markForCheck();
                }
            });
    }

    discardEdit() {
        this.editContent = this.rawSrtContent;
        this.editDirty = false;
        this.saveError = '';
        this.saveSuccess = false;
    }

    // ─── Markdown rendering (Read mode) ──────────────────────────────────────

    renderMarkdown(text: string): string {
        return text
            .replace(/\{[^}]*\}/g, '')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/_(.*?)_/g, '<em>$1</em>');
    }

    // ─── Mode switching ──────────────────────────────────────────────────────

    onModeChange(newMode: TranscriptMode) {
        if (this.mode === 'edit') {
            this.savedEditScrollTop =
                this.editTextarea?.nativeElement?.scrollTop ?? 0;
            this.scrollAnchorIndex = this.activeSegmentIndex;
        } else {
            this.scrollAnchorIndex = this.getFirstVisibleSegmentIndex();
        }

        this.lastScrolledIndex = -1;
        this.mode = newMode;
        this.modeChanged.emit(newMode);

        if (newMode === 'edit') {
            this.editContent = this.rawSrtContent;
            this.editDirty = false;
        }

        setTimeout(() => this.restoreScrollAnchor(), 50);
    }

    /**
     * Returns the segment array index of the first visible element in the
     * current scroll container. In Read mode, maps the visible paragraph back
     * to its firstSegmentArrayIndex so the anchor is always a segment index.
     */
    private getFirstVisibleSegmentIndex(): number {
        if (this.mode === 'read') {
            const container = this.readContainer?.nativeElement;
            if (!container) return this.activeSegmentIndex;
            const { top, bottom } = container.getBoundingClientRect();
            const items =
                container.querySelectorAll<HTMLElement>('.read-paragraph');
            for (let i = 0; i < items.length; i++) {
                const r = items[i].getBoundingClientRect();
                if (r.bottom > top && r.top < bottom) {
                    return (
                        this.readParagraphs[i]?.firstSegmentArrayIndex ??
                        this.activeSegmentIndex
                    );
                }
            }
            return this.activeSegmentIndex;
        }

        const container = this.timedContainer?.nativeElement;
        if (!container) return this.activeSegmentIndex;
        const { top, bottom } = container.getBoundingClientRect();
        const items = container.querySelectorAll<HTMLElement>('.segment');
        for (let i = 0; i < items.length; i++) {
            const r = items[i].getBoundingClientRect();
            if (r.bottom > top && r.top < bottom) return i;
        }
        return this.activeSegmentIndex;
    }

    private restoreScrollAnchor() {
        if (this.mode === 'edit') {
            const el = this.editTextarea?.nativeElement;
            if (!el) return;
            el.scrollTop =
                this.savedEditScrollTop > 0
                    ? this.savedEditScrollTop
                    : this.calcEditScrollTopForSegment(this.scrollAnchorIndex);
            return;
        }

        const idx = this.scrollAnchorIndex;
        if (idx < 0 || !this.srtSegments.length) return;

        if (this.mode === 'read') {
            // Map segment index → paragraph index, then scroll to that paragraph
            const paraIdx = this.readParagraphs.findIndex(
                (p) =>
                    idx >= p.firstSegmentArrayIndex &&
                    idx <= p.lastSegmentArrayIndex
            );
            const container = this.readContainer?.nativeElement;
            if (!container) return;
            const items =
                container.querySelectorAll<HTMLElement>('.read-paragraph');
            const el = items[paraIdx >= 0 ? paraIdx : 0];
            if (el) el.scrollIntoView({ block: 'start' });
        } else {
            const container = this.timedContainer?.nativeElement;
            if (!container) return;
            const items = container.querySelectorAll<HTMLElement>('.segment');
            const el = items[idx];
            if (el) el.scrollIntoView({ block: 'start' });
        }
    }

    /**
     * Restores scroll and cursor position in the edit textarea from the
     * initialEditScroll / initialEditCursor inputs (set by the shell from URL params).
     */
    private restoreEditPosition() {
        const el = this.editTextarea?.nativeElement;
        if (!el) return;
        if (this.initialEditScroll > 0) {
            el.scrollTop = this.initialEditScroll;
        }
        if (this.initialEditCursor > 0) {
            el.setSelectionRange(
                this.initialEditCursor,
                this.initialEditCursor
            );
            el.focus();
        }
    }

    private calcEditScrollTopForSegment(segmentIndex: number): number {
        const el = this.editTextarea?.nativeElement;
        if (!el || !this.rawSrtContent) return 0;
        const seg = this.srtSegments[segmentIndex];
        if (!seg) return 0;
        const pattern = new RegExp(`(?:^|\\n)(${seg.index})\\s*\\n`);
        const match = pattern.exec(this.rawSrtContent);
        if (!match) return 0;
        return (match.index / this.rawSrtContent.length) * el.scrollHeight;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    get tapeLabel(): string {
        if (!this.tape) return '';
        const parts: string[] = [];
        if (this.tape.event?.trim()) parts.push(this.tape.event.trim());
        if (
            this.tape.title?.trim() &&
            this.tape.title.trim() !== this.tape.event?.trim()
        )
            parts.push(this.tape.title.trim());
        if (parts.length === 0)
            parts.push(
                this.tape.text?.trim() || this.tape._text?.trim() || 'Untitled'
            );
        return parts.join(' — ');
    }

    get hasAnyTranscript(): boolean {
        return this.tape?.hasTranscript ?? false;
    }

    get showModeToggle(): boolean {
        return !!this.tape?.hasSrt;
    }

    get activeSegment(): SrtSegment | null {
        return this.activeSegmentIndex >= 0
            ? this.srtSegments[this.activeSegmentIndex]
            : null;
    }
}
