import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  Body,
  Req,
  Res,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as fs from 'fs';

import { SpeakersService, ForbiddenPathError } from './speakers.service';
import { Speaker } from './interfaces/speaker.interface';
import { Tape } from './interfaces/tape.interface';
import { SearchResult } from './interfaces/search-result.interface';

@Controller('speakers')
export class SpeakersController {
  private readonly logger = new Logger(SpeakersController.name);

  constructor(private readonly speakersService: SpeakersService) {}

  // ─── GET /api/speakers ────────────────────────────────────────────────────────
  // Returns an array of { id, name } objects for each speaker directory.

  @Get()
  getSpeakers(): Speaker[] {
    try {
      return this.speakersService.getSpeakers();
    } catch (err) {
      this.logger.error('Error listing speakers', err);
      throw new HttpException('Could not list speakers.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ─── GET /api/speakers/:speaker/tapes ────────────────────────────────────────
  // Returns the enriched tapes list for a speaker.

  @Get(':speaker/tapes')
  getTapes(@Param('speaker') speaker: string): Tape[] {
    try {
      return this.speakersService.getTapes(speaker);
    } catch (err) {
      if (err instanceof ForbiddenPathError) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
      this.logger.error(`Error loading tapes for ${speaker}`, err);
      throw new HttpException('Could not load tapes.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ─── GET /api/speakers/:speaker/audio/:filename ───────────────────────────────
  // Streams an MP3 file, supporting HTTP Range requests for browser seek support.

  @Get(':speaker/audio/:filename')
  streamAudio(
    @Param('speaker') speaker: string,
    @Param('filename') filename: string,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const filePath = this.speakersService.getAudioFilePath(speaker, filename);

    if (!filePath) {
      res.status(HttpStatus.FORBIDDEN).json({ error: 'Forbidden' });
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.status(HttpStatus.NOT_FOUND).json({ error: 'File not found' });
      return;
    }

    const stat     = fs.statSync(filePath);
    const fileSize = stat.size;
    const range    = req.headers.range;

    if (range) {
      // Partial content (206) — required for audio seeking in browsers
      const parts     = range.replace(/bytes=/, '').split('-');
      const start     = parseInt(parts[0], 10);
      const end       = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(HttpStatus.PARTIAL_CONTENT, {
        'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': chunkSize,
        'Content-Type':   'audio/mpeg',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(HttpStatus.OK, {
        'Content-Length': fileSize,
        'Content-Type':   'audio/mpeg',
        'Accept-Ranges':  'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  }

  // ─── GET /api/speakers/:speaker/transcript/:filename ─────────────────────────
  // Returns raw SRT or TXT transcript content as plain text.

  @Get(':speaker/transcript/:filename')
  streamTranscript(
    @Param('speaker') speaker: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ): void {
    const filePath = this.speakersService.getTranscriptFilePath(speaker, filename);

    if (!filePath) {
      res.status(HttpStatus.FORBIDDEN).json({ error: 'Forbidden' });
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.status(HttpStatus.NOT_FOUND).json({ error: 'File not found' });
      return;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    fs.createReadStream(filePath).pipe(res);
  }

  // ─── PUT /api/speakers/:speaker/transcript/:filename ─────────────────────────
  // Saves new content to a .srt or .txt transcript file.

  @Put(':speaker/transcript/:filename')
  @HttpCode(HttpStatus.NO_CONTENT)
  saveTranscript(
    @Param('speaker') speaker: string,
    @Param('filename') filename: string,
    @Body('content') content: string,
  ): void {
    if (typeof content !== 'string') {
      throw new HttpException('Missing content field.', HttpStatus.BAD_REQUEST);
    }
    try {
      this.speakersService.saveTranscript(speaker, filename, content);
    } catch (err) {
      if (err instanceof ForbiddenPathError) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
      this.logger.error(`Error saving transcript ${speaker}/${filename}`, err);
      throw new HttpException('Could not save transcript.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ─── GET /api/speakers/:speaker/favorites ────────────────────────────────────
  // Returns the list of favorited tape filenames for a speaker.

  @Get(':speaker/favorites')
  getFavorites(@Param('speaker') speaker: string): string[] {
    try {
      return this.speakersService.getFavorites(speaker);
    } catch (err) {
      if (err instanceof ForbiddenPathError) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
      this.logger.error(`Error loading favorites for ${speaker}`, err);
      throw new HttpException('Could not load favorites.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ─── PUT /api/speakers/:speaker/favorites ─────────────────────────────────────
  // Saves the full favorites list for a speaker.

  @Put(':speaker/favorites')
  @HttpCode(HttpStatus.NO_CONTENT)
  saveFavorites(
    @Param('speaker') speaker: string,
    @Body('favorites') favorites: string[],
  ): void {
    if (!Array.isArray(favorites)) {
      throw new HttpException('Missing favorites field.', HttpStatus.BAD_REQUEST);
    }
    try {
      this.speakersService.saveFavorites(speaker, favorites);
    } catch (err) {
      if (err instanceof ForbiddenPathError) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
      this.logger.error(`Error saving favorites for ${speaker}`, err);
      throw new HttpException('Could not save favorites.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ─── GET /api/speakers/:speaker/search?q=query ───────────────────────────────
  // Searches SRT transcripts and returns matches grouped by tape.

  @Get(':speaker/search')
  search(
    @Param('speaker') speaker: string,
    @Query('q') q: string = '',
  ): SearchResult[] {
    try {
      return this.speakersService.search(speaker, q);
    } catch (err) {
      if (err instanceof ForbiddenPathError) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
      this.logger.error(`Error searching ${speaker}`, err);
      throw new HttpException('Search failed.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
