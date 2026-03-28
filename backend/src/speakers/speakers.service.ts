import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

import { Speaker } from './interfaces/speaker.interface';
import { Tape, TapeJson } from './interfaces/tape.interface';
import { SrtSegment } from './interfaces/srt-segment.interface';
import { SearchMatch, SearchResult } from './interfaces/search-result.interface';

/** Root directory containing all speaker subdirectories. */
const SPEAKERS_PATH = path.resolve(__dirname, '../../../../speakers');

@Injectable()
export class SpeakersService {
  private readonly logger = new Logger(SpeakersService.name);

  // ─── Path safety ────────────────────────────────────────────────────────────

  /**
   * Resolves a path from SPEAKERS_PATH and verifies it does not escape
   * outside that root directory. Returns the resolved path, or null if
   * the result would be outside the allowed root.
   */
  safePath(...segments: string[]): string | null {
    const resolved = path.resolve(SPEAKERS_PATH, ...segments);
    if (
      resolved !== SPEAKERS_PATH &&
      !resolved.startsWith(SPEAKERS_PATH + path.sep)
    ) {
      return null;
    }
    return resolved;
  }

  // ─── Speakers ────────────────────────────────────────────────────────────────

  getSpeakers(): Speaker[] {
    const entries = fs.readdirSync(SPEAKERS_PATH, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => ({
        id: e.name,
        name: e.name.charAt(0).toUpperCase() + e.name.slice(1),
      }));
  }

  // ─── Tapes ────────────────────────────────────────────────────────────────────

  getTapes(speaker: string): Tape[] {
    const tapesJsonPath = this.safePath(speaker, 'tapes.json');
    const tapesDirPath  = this.safePath(speaker, 'tapes');

    if (!tapesJsonPath || !tapesDirPath) {
      throw new ForbiddenPathError();
    }

    const raw   = fs.readFileSync(tapesJsonPath, 'utf8');
    const tapes = JSON.parse(raw) as TapeJson[];

    return tapes.map(tape => {
      const filename  = path.basename(tape['local-url'] ?? '');
      const audioPath = path.join(tapesDirPath, filename);
      const srtPath   = path.join(tapesDirPath, `${filename}.srt`);
      const txtPath   = path.join(tapesDirPath, `${filename}.txt`);

      return {
        ...tape,
        filename,
        audioExists:   fs.existsSync(audioPath),
        hasSrt:        fs.existsSync(srtPath),
        hasTxt:        fs.existsSync(txtPath),
        hasTranscript: fs.existsSync(srtPath) || fs.existsSync(txtPath),
      };
    });
  }

  // ─── File paths (for streaming) ───────────────────────────────────────────────

  /**
   * Returns the resolved audio file path for streaming, or null if the path
   * would escape the speakers directory.
   */
  getAudioFilePath(speaker: string, filename: string): string | null {
    return this.safePath(speaker, 'tapes', filename);
  }

  /**
   * Returns the resolved transcript file path for streaming, or null if the path
   * would escape the speakers directory.
   */
  getTranscriptFilePath(speaker: string, filename: string): string | null {
    return this.safePath(speaker, 'tapes', filename);
  }

  /**
   * Writes new content to a transcript file (.srt or .txt). Returns true on
   * success, or throws ForbiddenPathError if the path would escape the root.
   */
  saveTranscript(speaker: string, filename: string, content: string): void {
    const filePath = this.safePath(speaker, 'tapes', filename);
    if (!filePath) throw new ForbiddenPathError();
    fs.writeFileSync(filePath, content, 'utf8');
  }

  // ─── Favorites ────────────────────────────────────────────────────────────────

  getFavorites(speaker: string): string[] {
    const filePath = this.safePath(speaker, 'favorites.json');
    if (!filePath) throw new ForbiddenPathError();
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  saveFavorites(speaker: string, favorites: string[]): void {
    const filePath = this.safePath(speaker, 'favorites.json');
    if (!filePath) throw new ForbiddenPathError();
    fs.writeFileSync(filePath, JSON.stringify(favorites, null, 2), 'utf8');
  }

  // ─── Search ───────────────────────────────────────────────────────────────────

  search(speaker: string, query: string): SearchResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const tapesJsonPath = this.safePath(speaker, 'tapes.json');
    if (!tapesJsonPath) throw new ForbiddenPathError();

    const raw   = fs.readFileSync(tapesJsonPath, 'utf8');
    const tapes = JSON.parse(raw) as TapeJson[];
    const results: SearchResult[] = [];

    for (const tape of tapes) {
      const filename = path.basename(tape['local-url'] ?? '');
      if (!filename) continue;

      const srtPath = this.safePath(speaker, 'tapes', `${filename}.srt`);
      if (!srtPath || !fs.existsSync(srtPath)) continue;

      const segments = this.parseSrt(fs.readFileSync(srtPath, 'utf8'));

      const matches: SearchMatch[] = segments
        .filter(seg => seg.text.toLowerCase().includes(q))
        .map(seg => ({
          text:         seg.text,
          startTime:    seg.startTime,
          endTime:      seg.endTime,
          segmentIndex: seg.index,
        }));

      if (matches.length === 0) continue;

      const audioPath = this.safePath(speaker, 'tapes', filename);
      const txtPath   = this.safePath(speaker, 'tapes', `${filename}.txt`);

      results.push({
        tape: {
          ...tape,
          filename,
          audioExists:   audioPath ? fs.existsSync(audioPath) : false,
          hasSrt:        true,
          hasTxt:        txtPath ? fs.existsSync(txtPath) : false,
          hasTranscript: true,
        },
        matches,
      });
    }

    return results;
  }

  // ─── SRT parsing ─────────────────────────────────────────────────────────────

  parseSrt(content: string): SrtSegment[] {
    const segments: SrtSegment[] = [];
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.trim().split(/\n\n+/);

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 3) continue;

      const index = parseInt(lines[0].trim(), 10);
      if (isNaN(index)) continue;

      const timeMatch = lines[1].match(
        /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
      );
      if (!timeMatch) continue;

      const text = lines
        .slice(2)
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .trim();

      segments.push({
        index,
        startTime: this.timeToSeconds(timeMatch[1]),
        endTime:   this.timeToSeconds(timeMatch[2]),
        text,
      });
    }

    return segments;
  }

  private timeToSeconds(timeStr: string): number {
    const normalized = timeStr.replace(',', '.');
    const parts      = normalized.split(':');
    return (
      parseInt(parts[0], 10) * 3600 +
      parseInt(parts[1], 10) * 60 +
      parseFloat(parts[2])
    );
  }
}

// ─── Domain errors ────────────────────────────────────────────────────────────

export class ForbiddenPathError extends Error {
  constructor() {
    super('Path traversal detected');
    this.name = 'ForbiddenPathError';
  }
}
