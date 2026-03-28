// export interface Speaker {
//   id: string;
//   name: string;
// }

// export interface Tape {
//   date: string;
//   location: string;
//   event: string;
//   title: string;
//   'local-url': string;
//   text: string;
//   link: string;
//   url: string;
//   _text: string;
//   // Enriched by backend
//   filename: string;
//   audioExists: boolean;
//   hasSrt: boolean;
//   hasTxt: boolean;
//   hasTranscript: boolean;
// }

// export interface SrtSegment {
//   index: number;
//   startTime: number; // seconds
//   endTime: number;   // seconds
//   text: string;
// }

// export interface SearchMatch {
//   text: string;
//   startTime: number;    // seconds into the tape
//   endTime: number;
//   segmentIndex: number; // SRT segment index
// }

// export interface SearchResult {
//   tape: Tape;
//   matches: SearchMatch[];
// }

export * from '@internal/types';
