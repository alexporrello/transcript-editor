import { Tape } from './tape.interface';

export interface SearchMatch {
  text: string;
  startTime: number;    // seconds into the tape
  endTime: number;
  segmentIndex: number; // SRT segment index
}

export interface SearchResult {
  tape: Tape;
  matches: SearchMatch[];
}
