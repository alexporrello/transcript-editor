/** Raw shape coming from a speaker's tapes.json file. */
export interface TapeJson {
  date: string;
  location: string;
  event: string;
  title: string;
  'local-url': string;
  text: string;
  link: string;
  url: string;
  _text: string;
  [key: string]: unknown;
}

/** tapes.json entry enriched with server-side availability flags. */
export interface Tape extends TapeJson {
  filename: string;
  audioExists: boolean;
  hasSrt: boolean;
  hasTxt: boolean;
  hasTranscript: boolean;
}
