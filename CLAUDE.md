# Tape Viewer — Project Context

A browser app for browsing and playing historical Alcoholics Anonymous recovery speaker recordings. Tapes are MP3 files stored on disk alongside optional SRT (timed subtitles) and TXT transcript files.

---

## Repository layout

```
tape-viewer/
├── frontend/          Angular 21 SPA
├── backend/           NestJS backend (Node.js + Express platform)
└── CLAUDE.md          ← you are here
```

Data lives **outside** this repo at `../../speakers/` (two levels above `tape-viewer/`). The backend resolves that path relative to its own compiled output in `dist/`.

---

## Data model

### Filesystem layout (per speaker)

```
speakers/
└── <speaker-id>/          e.g. "clancy"
    ├── tapes.json         metadata array
    ├── favorites.json     favorited filenames array (created on first save)
    └── tapes/
        ├── some-talk.mp3
        ├── some-talk.mp3.srt   optional timed transcript
        └── some-talk.mp3.txt   optional plain-text transcript
```

### `tapes.json` shape (raw, from disk)

```json
{
  "date": "1988-06-15",
  "location": "Denver, CO",
  "event": "KY State Convention",
  "title": "The Road to Recovery",
  "local-url": "./tapes/filename.mp3",
  "text": "Display label",
  "_text": "Alternate label",
  "link": "https://source-site.com/...",
  "url": "https://cdn.example.com/..."
}
```

### Enriched `Tape` (added by the backend at request time)

| Field | Type | Description |
|---|---|---|
| `filename` | string | `path.basename(local-url)` |
| `audioExists` | boolean | MP3 file present on disk |
| `hasSrt` | boolean | `.srt` file present |
| `hasTxt` | boolean | `.txt` file present |
| `hasTranscript` | boolean | either SRT or TXT present |

---

## API

All routes share the prefix `/api`. The Angular dev-server proxies `/api/*` to `http://localhost:3000` via `frontend/proxy.conf.json`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/speakers` | List all speaker directories as `{ id, name }[]` |
| GET | `/api/speakers/:speaker/tapes` | Enriched tape array for a speaker |
| GET | `/api/speakers/:speaker/audio/:filename` | Stream MP3 (supports HTTP Range for seeking) |
| GET | `/api/speakers/:speaker/transcript/:filename` | Return raw SRT or TXT as `text/plain` |
| PUT | `/api/speakers/:speaker/transcript/:filename` | Save edited SRT content; body `{ content: string }`; returns 204 |
| GET | `/api/speakers/:speaker/search?q=` | Search SRT content; returns `SearchResult[]` |
| GET | `/api/speakers/:speaker/favorites` | Return favorited filenames as `string[]`; returns `[]` if none saved yet |
| PUT | `/api/speakers/:speaker/favorites` | Save favorites list; body `{ favorites: string[] }`; returns 204 |

### `SearchResult` shape

```typescript
interface SearchMatch  { text: string; startTime: number; endTime: number; segmentIndex: number; }
interface SearchResult { tape: Tape; matches: SearchMatch[]; }
```

---

## Backend — `backend/`

**NestJS 11** with `@nestjs/platform-express`. Structured as a single NestJS module.

```
src/
├── main.ts                          CORS + global /api prefix
├── app.module.ts                    imports SpeakersModule
└── speakers/
    ├── speakers.module.ts
    ├── speakers.controller.ts       HTTP layer — all 8 routes
    ├── speakers.service.ts          Business logic: safePath, SRT parser, file I/O
    └── interfaces/
        ├── speaker.interface.ts
        ├── tape.interface.ts        TapeJson (raw) + Tape (enriched)
        ├── srt-segment.interface.ts
        └── search-result.interface.ts
```

**Key decisions:**
- Audio & transcript routes use `@Res()` with raw `writeHead` + `createReadStream().pipe(res)` — NestJS `StreamableFile` doesn't support HTTP Range natively.
- Express types (`Request`, `Response`) must be imported as `import type` because `emitDecoratorMetadata` + `isolatedModules` are both enabled.
- `ForbiddenPathError` is thrown by the service and caught by the controller to avoid leaking HTTP concepts into business logic.
- `SPEAKERS_PATH` resolves to `../../../../speakers` relative to the compiled `dist/speakers/` output directory (same two-levels-up convention as v1).
- The PUT transcript route uses `@Body('content')` to extract the `content` field from the JSON body and writes it directly to disk via `fs.writeFileSync`.
- The PUT favorites route uses `@Body('favorites')` to extract the filenames array and writes it to `favorites.json` via `fs.writeFileSync`. The GET route returns `[]` (not a 404) when no `favorites.json` exists yet.

Start: `npm run start:dev` from `backend/`

---

## Frontend — `frontend/`

**Angular 21**, standalone components, route-driven navigation.

```
src/app/
├── services/
│   ├── tape.service.ts               HTTP calls (getSpeakers, getTapes, getTranscript, saveTranscript, searchTranscripts, getFavorites, saveFavorites)
│   ├── player-state.service.ts       RxJS BehaviorSubject state + audio element control
│   ├── search-state.service.ts       Persists search query + results across route changes
│   └── favorites.service.ts          Signal-based favorites state; loads per speaker, persists via TapeService
└── components/
    ├── shell/                        App layout — two floating cards, breadcrumb, route sync
    ├── speaker-list/                 Speaker selection (shown at /)
    ├── tape-list/                    Tape rows for selected speaker (shown at /speakers/:id)
    ├── tape/                         Single tape row (title, date chip, location, star button)
    ├── player/                       <audio> wrapper; registers with PlayerStateService
    ├── transcript/                   Three-mode transcript viewer (see below)
    └── search/                       Transcript search panel (shown at /speakers/:id/search)
```

### Layout

The app uses a NotebookLM-inspired two-card layout on a dark background:

- **Left card** — header with breadcrumb (`Speakers › Clancy`) and search icon; body shows the speaker list at `/` or the tape list at `/speakers/:id`.
- **Right card** — body shows the transcript for the selected tape, or the search panel at `/search`; footer is the persistent `<audio>` player, shown whenever a tape is loaded.

### Routing

The router is the single source of truth for navigation state. `ShellComponent` listens to `NavigationEnd` events, parses the URL, and drives `PlayerStateService` accordingly — components never call `setSelectedTape` directly, they navigate instead.

| Route | Description |
|---|---|
| `/` | Speaker selection |
| `/speakers/:speakerId` | Tape list; no tape selected |
| `/speakers/:speakerId?tape=filename.mp3` | Tape list; tape selected, transcript shown |
| `/speakers/:speakerId/search` | Search panel for that speaker |

**Note:** The tape filename is a query parameter (`?tape=`), not a path segment. MP3 filenames contain dots which cause Angular's router to misidentify them as static file requests.

### Key services

**`PlayerStateService`**
- BehaviorSubjects: `selectedSpeaker$`, `selectedTape$`, `currentTime$`, `duration$`, `isPlaying$`
- `registerAudioElement(el)` — wires up native audio events; also applies any `pendingSeekTime` on `loadedmetadata`
- `seekWhenReady(time)` — stores a pending seek that fires once the next audio src has loaded metadata; used by the search component when jumping to a match in an unloaded tape
- `seek(time)` — seeks immediately if audio is loaded
- `skip(seconds)` — seeks relative to current position; used by keyboard shortcuts

**`TapeService`**
- `getSpeakers()`, `getTapes(id)`, `getTranscript(id, filename)`, `getAudioUrl(id, filename)`
- `saveTranscript(speakerId, filename, content)` → `Observable<void>` — PUT to backend
- `searchTranscripts(speakerId, query)` → `Observable<SearchResult[]>`
- `getFavorites(speakerId)` → `Observable<string[]>` — GET from backend
- `saveFavorites(speakerId, favorites)` → `Observable<void>` — PUT to backend

**`FavoritesService`**
- Holds `favorites = signal<Set<string>>(new Set())` for the current speaker's favorited filenames.
- Subscribes to `PlayerStateService.selectedSpeaker$` at construction time to reload favorites whenever the speaker changes.
- `isFavorite(filename)` — reads directly from the signal; safe to call in templates.
- `toggleFavorite(speakerId, filename)` — optimistically updates the signal, persists via `TapeService.saveFavorites`, and rolls back the signal on error.

**`SearchStateService`**
- Persists `query`, `results`, `loading`, and `searchPerformed` as BehaviorSubjects so navigating away from `/search` and back restores the previous state.
- `clearForSpeaker(id)` — resets state when the active speaker changes.

### Transcript component — three modes

`app-transcript` displays SRT/TXT transcripts in three switchable modes. The mode toggle is shown whenever `tape.hasSrt` is true; TXT-only tapes go straight to Read with no toggle.

**Timed** — segments listed with timecodes in a scrollable list. Active segment is highlighted and auto-scrolled as the audio plays. Clicking any segment seeks the audio to its start time.

**Read** — SRT segments rendered as flowing prose. Consecutive segments with no blank line between them in the raw SRT are merged into a single paragraph; a blank line between blocks is a paragraph break. Each paragraph shows a subtle gutter timestamp. Clicking a paragraph seeks the audio. Active paragraph highlighted and auto-scrolled. Markdown in segment text is rendered: `**bold**` → `<strong>`, `*italic*` / `_italic_` → `<em>`. TXT-only tapes render as plain text.

**Edit** — raw SRT content in a monospaced `<textarea>`. A status bar at the bottom shows the currently playing segment. Clicking in the textarea seeks the audio to the timestamp of whichever SRT block the cursor is in — but only if that start time differs from the last time a seek was triggered from an edit-mode click (`lastEditSeekTime`). This prevents redundant seeks when clicking multiple times within the same SRT block. `lastEditSeekTime` is reset to `null` when a seek originates from outside edit mode (timed/read click via `seekToSegment`/`seekToTime`) or when a new tape loads, so the next edit click always seeks in those cases. Mode switches do not reset `lastEditSeekTime`. Save / Discard buttons appear when there are unsaved changes; saving re-parses the SRT so Timed/Read modes stay in sync.

#### SRT paragraph convention (Read mode)

The paragraph structure is encoded directly in the SRT file's blank-line spacing:
- **No blank line** between consecutive blocks → blocks are merged into one paragraph in Read mode.
- **Blank line** between blocks → paragraph break (this is the standard SRT separator).

This means a freshly generated SRT (standard format, one blank line between every block) renders every segment as its own paragraph. The user removes blank lines in Edit mode to merge segments into paragraphs.

#### Edit mode keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + S` | Save |
| `Ctrl/Cmd + B` | Bold — wraps selection in `**...**`; toggles off if already wrapped |
| `Ctrl/Cmd + I` | Italic — wraps selection in `*...*`; toggles off if already wrapped |
| `Ctrl/Cmd + X` (no selection) | Cut current line to clipboard |

All shortcuts use `document.execCommand('insertText')` to preserve the browser's native undo/redo stack.

#### Scroll position across mode switches

When switching modes the component preserves scroll context:
- Leaving **Timed** or **Read**: captures the first visible element (segment or paragraph) as a scroll anchor; restores it in the new mode.
- Leaving **Edit**: saves the textarea's `scrollTop` in pixels and restores it exactly on return. On first entry into Edit, scrolls proportionally to the active segment.

### Global keyboard shortcuts (ShellComponent)

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Shift + F` | Toggle search panel |
| `Ctrl/Cmd + Shift + →` | Skip audio forward 10 s |
| `Ctrl/Cmd + Shift + ←` | Skip audio back 10 s |
| `Escape` | Close search panel (when on search route) |

### Favorites feature

Each tape row shows a star icon button (`star_border` / `star`) in the badge area. The button is hidden until the row is hovered, and always visible when the tape is already favorited. Clicking it calls `FavoritesService.toggleFavorite()` and stops the click from propagating to the tape-selection handler.

`TapeListComponent` exposes a `showFavoritesOnly` signal (toggled by a star button in a filter bar above the list) and a `hasFavorites` computed that controls whether the filter bar is shown at all. The `displayedTapes` computed returns either the full tape list or just the favorited subset. Both signals reset when the active speaker changes.

Favorites are stored in `speakers/<id>/favorites.json` as a flat `string[]` of filenames. The file is created on first save and is absent until at least one tape is favorited.

### Search feature

Triggered by the **search icon** in the left card header or **⌘⇧F / Ctrl+Shift+F** globally. Navigates to `/speakers/:id/search`; the right card body switches to `SearchComponent`. Clicking a match calls `seekWhenReady()` then navigates to `/speakers/:id?tape=filename.mp3`, so the shell loads the tape and the audio seeks to the matched timestamp on `loadedmetadata`.

### tsconfig notes

- `"useDefineForClassFields": false` is required. With `"target": "ES2022"` the default is `true`, which causes class field initializers (e.g. `toSignal(this.service.obs$)`) to run before constructor parameter properties are assigned.

Start: `npm start` from `frontend/` (proxies `/api` to `:3000`)

---

## Running locally

```bash
# Terminal 1 — backend
cd backend && npm run start:dev

# Terminal 2 — frontend
cd frontend && npm start
# Opens at http://localhost:4200
```
