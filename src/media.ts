// Videos and sounds, which open in a tab of their own rather than as text, by
// their extension: what kind each is, the type it is served as, and the name
// its tab gives the format. Whether one really plays is the browser's to say
// (media-page.ts): Chromium plays H.264, VP8/VP9, AV1, AAC, MP3, Vorbis, Opus,
// FLAC and WAV, but not Theora or ProRes, and HEVC only where the system can.
// Also the byte ranges a player asks for while it seeks (parseRange), answered
// the same by the app's protocol and the browser build's server (media-serve.ts).

export type MediaKind = 'video' | 'audio';

export interface MediaType {
  kind: MediaKind;
  type: string;
  format: string;
}

const types: Record<string, MediaType> = {
  mp4: { kind: 'video', type: 'video/mp4', format: 'MP4' },
  m4v: { kind: 'video', type: 'video/mp4', format: 'M4V' },
  webm: { kind: 'video', type: 'video/webm', format: 'WebM' },
  ogv: { kind: 'video', type: 'video/ogg', format: 'Ogg' },
  mov: { kind: 'video', type: 'video/quicktime', format: 'QuickTime' },
  // Chromium plays Matroska with the codecs it knows (H.264, VP9, AV1 with AAC
  // or Opus); one with others says it cannot be played, as an MOV may.
  mkv: { kind: 'video', type: 'video/x-matroska', format: 'Matroska' },
  wav: { kind: 'audio', type: 'audio/wav', format: 'WAV' },
  mp3: { kind: 'audio', type: 'audio/mpeg', format: 'MP3' },
  ogg: { kind: 'audio', type: 'audio/ogg', format: 'Ogg' },
  oga: { kind: 'audio', type: 'audio/ogg', format: 'Ogg' },
  flac: { kind: 'audio', type: 'audio/flac', format: 'FLAC' },
  m4a: { kind: 'audio', type: 'audio/mp4', format: 'M4A' },
  aac: { kind: 'audio', type: 'audio/aac', format: 'AAC' },
  opus: { kind: 'audio', type: 'audio/ogg', format: 'Opus' },
};

export const mediaType = (filePath: string): MediaType | null =>
  types[/\.([^./\\]+)$/.exec(filePath)?.[1]?.toLowerCase() ?? ''] ?? null;

// A file the backend has checked may be read, for the main process or the
// server to give the window a URL for, in place of where it is.
export type MediaSource = Omit<GlistMediaFile, 'url'> & { path: string };

// The name a window is given for a file: hex, and long enough not to be guessed.
export const mediaIdPattern = /^[0-9a-f]{32}$/;
// The id in a URL handed out: glist-media://media/<id>/<name> or /media/<id>/<name>.
export const mediaIdOf = (url: unknown): string | null =>
  (typeof url === 'string' ? /\/([0-9a-f]{32})(?:\/[^/]*)?$/.exec(url)?.[1] ?? null : null);

export interface ByteRange {
  start: number;
  end: number;
}

// A Range header as a player sends it, bytes=start-end, start- or -last: the
// bytes it asks for, ended at the end of the file; null to send all of it,
// for no header, one that cannot be read or one asking for several ranges,
// which a server may answer with the whole file; or unsatisfiable, starting
// past the end.
export const parseRange = (header: string | null | undefined, size: number): ByteRange | 'unsatisfiable' | null => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const last = Number(match[2]);
    if (last === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Number(match[2]);
  if (match[2] !== '' && end < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
};

export interface MediaReply {
  status: 200 | 206 | 416;
  headers: Record<string, string>;
  // The bytes to send, none for an empty file or a range past its end.
  range?: ByteRange;
}

// The answer to a request for a file of this size: all of it, the range asked
// for, or none when the range starts past its end.
export const mediaReply = (size: number, type: string, rangeHeader?: string | null): MediaReply => {
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') return { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' } };
  if (!range) return { status: 200, headers: { ...headers, 'Content-Length': String(size) }, ...(size > 0 ? { range: { start: 0, end: size - 1 } } : {}) };
  return {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': String(range.end - range.start + 1) },
    range,
  };
};
