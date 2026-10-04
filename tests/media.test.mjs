import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mediaIdOf, mediaReply, mediaType, parseRange } from '../src/media.ts';
import { audioFacts } from '../src/media-info.ts';
import { mediaFile, MediaGrants, readAudioFacts } from '../src/media-serve.ts';

// Which files open as videos and sounds, by extension, whatever its case.
for (const [file, kind, type] of [
  ['clip.mp4', 'video', 'video/mp4'], ['a/b/C.M4V', 'video', 'video/mp4'], ['x.webm', 'video', 'video/webm'],
  ['x.ogv', 'video', 'video/ogg'], ['x.mov', 'video', 'video/quicktime'],
  ['x.wav', 'audio', 'audio/wav'], ['x.mp3', 'audio', 'audio/mpeg'], ['x.ogg', 'audio', 'audio/ogg'], ['x.oga', 'audio', 'audio/ogg'],
  ['x.flac', 'audio', 'audio/flac'], ['x.m4a', 'audio', 'audio/mp4'], ['x.aac', 'audio', 'audio/aac'], ['C:\\s\\x.Opus', 'audio', 'audio/ogg'],
]) {
  assert.equal(mediaType(file)?.kind, kind, file);
  assert.equal(mediaType(file)?.type, type, file);
}
assert.equal(mediaType('x.mp4').format, 'MP4');
assert.equal(mediaType('x.opus').format, 'Opus');
// Matroska as Chromium plays it, with the codecs it knows.
assert.deepEqual(mediaType('clip.MKV'), { kind: 'video', type: 'video/x-matroska', format: 'Matroska' });
// Not claimed: AVI, which Chromium does not play, and what is not media.
for (const file of ['x.avi', 'x.png', 'mp4', 'clips.mp4/readme', 'x.', '']) assert.equal(mediaType(file), null, file);

// Ranges as players ask for them, and what is made of the rest.
assert.equal(parseRange(undefined, 100), null);
assert.equal(parseRange('', 100), null);
assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 });
assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
assert.deepEqual(parseRange(' bytes=10-19 ', 100), { start: 10, end: 19 });
assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 }, 'an end past the file ends at its end');
assert.deepEqual(parseRange('bytes=99-99', 100), { start: 99, end: 99 });
assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 }, 'the last ten bytes');
assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 }, 'more than there is: all of it');
assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable', 'starting at the end');
assert.equal(parseRange('bytes=5000-6000', 100), 'unsatisfiable');
assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
assert.equal(parseRange('bytes=0-', 0), 'unsatisfiable', 'an empty file has no first byte');
assert.equal(parseRange('bytes=99999999999999999999-', 100), 'unsatisfiable');
// Several ranges, or one that cannot be read: the whole file, as a server may answer.
for (const header of ['bytes=0-1,5-6', 'bytes=0-1, 5-6', 'bytes=-', 'bytes=a-b', 'bytes=5-1', 'items=0-1', 'bytes 0-1', 'bytes=0x10-', 'bytes=-1-2']) {
  assert.equal(parseRange(header, 100), null, header);
}

// The answers' status and headers.
let reply = mediaReply(100, 'audio/wav');
assert.equal(reply.status, 200);
assert.deepEqual(reply.range, { start: 0, end: 99 });
assert.equal(reply.headers['Content-Length'], '100');
assert.equal(reply.headers['Accept-Ranges'], 'bytes');
assert.equal(reply.headers['Content-Type'], 'audio/wav');
assert.equal(reply.headers['Content-Range'], undefined);
reply = mediaReply(100, 'video/mp4', 'bytes=10-');
assert.equal(reply.status, 206);
assert.equal(reply.headers['Content-Range'], 'bytes 10-99/100');
assert.equal(reply.headers['Content-Length'], '90');
reply = mediaReply(100, 'video/mp4', 'bytes=200-');
assert.equal(reply.status, 416);
assert.equal(reply.headers['Content-Range'], 'bytes */100');
assert.equal(reply.range, undefined);
reply = mediaReply(0, 'video/mp4');
assert.equal(reply.status, 200);
assert.equal(reply.headers['Content-Length'], '0');
assert.equal(reply.range, undefined, 'nothing to read from an empty file');

// The id in the URLs handed out, and nothing else.
const id = '0123456789abcdef0123456789abcdef';
assert.equal(mediaIdOf(`glist-media://media/${id}/a%20b.mp4`), id);
assert.equal(mediaIdOf(`/media/${id}/clip.mp4`), id);
assert.equal(mediaIdOf(`/media/${id}`), id);
assert.equal(mediaIdOf('/media/0123/clip.mp4'), null);
assert.equal(mediaIdOf(`/media/${id.toUpperCase()}/clip.mp4`), null);
assert.equal(mediaIdOf(`/media/${id}/a/b.mp4`), null);
assert.equal(mediaIdOf(42), null);

// Sample rates and channels from files' headers.
const u16 = (value) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; };
const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const be32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };
const be16 = (value) => { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b; };
const reader = (bytes) => async (offset, length) => bytes.subarray(offset, offset + length);
const facts = (bytes) => audioFacts(reader(bytes), bytes.length);
const wav = (channels, rate, before = Buffer.alloc(0)) => Buffer.concat([
  Buffer.from('RIFF'), u32(0), Buffer.from('WAVE'), before,
  Buffer.from('fmt '), u32(16), u16(1), u16(channels), u32(rate), u32(rate * channels * 2), u16(channels * 2), u16(16),
  Buffer.from('data'), u32(4), Buffer.alloc(4),
]);
assert.deepEqual(await facts(wav(2, 44100)), { channels: 2, sampleRate: 44100 });
// A chunk before fmt, of odd length and so padded.
assert.deepEqual(await facts(wav(1, 22050, Buffer.concat([Buffer.from('LIST'), u32(3), Buffer.from('abc\0')]))), { channels: 1, sampleRate: 22050 });

const streamInfo = (rate, channels) => {
  const block = Buffer.alloc(34);
  block[10] = rate >> 12;
  block[11] = (rate >> 4) & 0xff;
  block[12] = ((rate & 0xf) << 4) | ((channels - 1) << 1);
  return block;
};
const flac = (rate, channels) => Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x80, 0, 0, 34]), streamInfo(rate, channels)]);
assert.deepEqual(await facts(flac(96000, 2)), { sampleRate: 96000, channels: 2 });
const id3 = (bodyLength) => Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, (bodyLength >> 7) & 0x7f, bodyLength & 0x7f]), Buffer.alloc(bodyLength)]);
assert.deepEqual(await facts(Buffer.concat([id3(300), flac(48000, 1)])), { sampleRate: 48000, channels: 1 }, 'FLAC after an ID3 tag');

const oggPage = (packet) => Buffer.concat([Buffer.from('OggS'), Buffer.alloc(22), Buffer.from([1, packet.length]), packet]);
assert.deepEqual(await facts(oggPage(Buffer.concat([Buffer.from('\x01vorbis', 'latin1'), u32(0), Buffer.from([2]), u32(44100), Buffer.alloc(16)]))),
  { codec: 'Vorbis', channels: 2, sampleRate: 44100 });
assert.deepEqual(await facts(oggPage(Buffer.concat([Buffer.from('OpusHead'), Buffer.from([1, 1]), u16(312), u32(16000), Buffer.alloc(3)]))),
  { codec: 'Opus', channels: 1, sampleRate: 48000 }, 'Opus plays at 48 kHz whatever it was made from');

// MP3: MPEG-1 at 44.1 kHz in joint stereo; MPEG-2 at 22.05 kHz in mono, after an ID3 tag and some junk.
assert.deepEqual(await facts(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x44]), Buffer.alloc(400)])), { sampleRate: 44100, channels: 2 });
assert.deepEqual(await facts(Buffer.concat([id3(1000), Buffer.from([0x00, 0xff, 0x00, 0xff, 0xf3, 0x80, 0xc4]), Buffer.alloc(200)])), { sampleRate: 22050, channels: 1 });
// AAC in ADTS: index 6, 24 kHz; one channel.
assert.deepEqual(await facts(Buffer.from([0xff, 0xf1, 0x58, 0x40, 0x10, 0x1f, 0xfc, 0, 0])), { sampleRate: 24000, channels: 1 });

// MP4 with its index after its media data, a video track before the sound's.
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([be32(body.length + 8), Buffer.from(type), body]); };
const full = (type, ...parts) => box(type, Buffer.alloc(4), ...parts);
const track = (handler, timescale, entry) => box('trak', box('mdia',
  full('mdhd', be32(0), be32(0), be32(timescale), be32(0), Buffer.alloc(4)),
  full('hdlr', be32(0), Buffer.from(handler), Buffer.alloc(13)),
  box('minf', box('stbl', full('stsd', be32(1), entry)))));
const mp4a = (channels, rate) => box('mp4a', Buffer.alloc(6), be16(1), Buffer.alloc(8), be16(channels), be16(16), Buffer.alloc(4), be32(rate * 65536), Buffer.alloc(20));
const m4a = Buffer.concat([
  box('ftyp', Buffer.from('M4A '), be32(0)),
  box('mdat', Buffer.alloc(5000)),
  box('moov', track('vide', 600, box('avc1', Buffer.alloc(70))), track('soun', 22050, mp4a(1, 22050))),
]);
assert.deepEqual(await facts(m4a), { channels: 1, sampleRate: 22050 });
// The entry says two channels, as Apple's files often do; AAC's own config in esds says one.
const esds = full('esds', Buffer.from([0x03, 0x80, 0x80, 0x80, 0x16, 0, 1, 0, 0x04, 0x11, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x05, 0x02, 0x13, 0x88]));
const appleM4a = Buffer.concat([box('ftyp', Buffer.from('M4A '), be32(0)), box('moov', track('soun', 22050,
  box('mp4a', Buffer.alloc(6), be16(1), Buffer.alloc(8), be16(2), be16(16), Buffer.alloc(4), be32(22050 * 65536), esds)))]);
assert.deepEqual(await facts(appleM4a), { channels: 1, sampleRate: 22050 });
// A rate too big for the entry's 16 bits: the track's timescale says it.
const hiRes = Buffer.concat([box('ftyp', Buffer.from('M4A '), be32(0)), box('moov', track('soun', 96000, mp4a(2, 0)))]);
assert.deepEqual(await facts(hiRes), { channels: 2, sampleRate: 96000 });
// Not a sound file, or a broken one: nothing is said.
for (const bytes of [Buffer.from('hello world, this is text'), Buffer.alloc(0), Buffer.from('RIFF\0\0\0\0WAVE'), Buffer.from('OggS'), box('ftyp', Buffer.from('M4A '))]) {
  assert.deepEqual(await facts(bytes), {}, bytes.toString('latin1'));
}

// Names handed out, and what they serve.
const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'glist-media-')));
// The status of an answer whose body is not wanted.
const status = (answer) => { answer.body?.destroy(); return answer.status; };
const read = async (answer) => {
  if (!answer.body) return null;
  const chunks = [];
  for await (const chunk of answer.body) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
};
try {
  const file = path.join(root, 'my clip.mp4');
  writeFileSync(file, '0123456789');
  const grants = new MediaGrants();
  const window = {};
  const other = {};
  const name = grants.grant(window, { path: file, type: 'video/mp4' });
  assert.match(name, /^[0-9a-f]{32}$/);
  assert.notEqual(grants.grant(window, { path: file, type: 'video/mp4' }), name, 'each time a new name');
  assert.ok(grants.owns(name, window) && !grants.owns(name, other));

  let answer = await grants.open(name);
  assert.equal(answer.status, 200);
  assert.equal(await read(answer), '0123456789');
  answer = await grants.open(name, 'bytes=2-5');
  assert.equal(answer.status, 206);
  assert.equal(answer.headers['Content-Range'], 'bytes 2-5/10');
  assert.equal(await read(answer), '2345');
  answer = await grants.open(name, 'bytes=-3');
  assert.equal(await read(answer), '789');
  answer = await grants.open(name, 'bytes=10-');
  assert.equal(answer.status, 416);
  assert.equal(answer.body, undefined);
  answer = await grants.open(name, 'bytes=0-1', 'HEAD');
  assert.equal(answer.status, 206);
  assert.equal(answer.body, undefined, 'HEAD has no body');
  // Read as the file is now, not as it was when the name was given.
  writeFileSync(file, '0123456789abcdef');
  assert.equal(await read(await grants.open(name, 'bytes=10-')), 'abcdef');

  // Only names handed out: never a made-up one, an upper-case one, or a path.
  for (const guess of ['0'.repeat(32), name.toUpperCase(), file, `../${path.basename(file)}`, '', `${name}/x`]) {
    const refused = await grants.open(guess);
    assert.equal(refused.status, 404, guess);
    assert.equal(refused.body, undefined);
  }

  // Let go of only by its window, which stops what is still reading the file.
  const reading = await grants.open(name, 'bytes=0-');
  grants.release(other, name);
  assert.equal(status(await grants.open(name)), 200, 'another window cannot let go of it');
  const closed = new Promise((resolve) => reading.body.once('close', resolve));
  grants.release(window, name);
  await closed;
  assert.ok(reading.body.destroyed, 'the stream reading the file is stopped');
  assert.equal((await grants.open(name)).status, 404, 'forgotten');
  grants.release(window, null);

  // A window gone forgets all its names, not another's.
  const first = grants.grant(window, { path: file, type: 'video/mp4' });
  const others = grants.grant(other, { path: file, type: 'video/mp4' });
  grants.releaseOwner(window);
  assert.equal((await grants.open(first)).status, 404);
  assert.equal(status(await grants.open(others)), 200);
  // A file gone is not found.
  unlinkSync(file);
  assert.equal((await grants.open(others)).status, 404);

  // The window gets a URL with the file's name, never its path.
  const given = mediaFile({ path: file, kind: 'video', type: 'video/mp4', format: 'MP4', size: 10 }, 'glist-media://media', name);
  assert.deepEqual(given, { kind: 'video', type: 'video/mp4', format: 'MP4', size: 10, url: `glist-media://media/${name}/my%20clip.mp4` });
  assert.equal(mediaIdOf(given.url), name);

  // A sound's facts read from the file on disk, and none from one that is not a sound.
  const sound = path.join(root, 'tone.wav');
  writeFileSync(sound, wav(2, 48000));
  assert.deepEqual(await readAudioFacts(sound, wav(2, 48000).length), { channels: 2, sampleRate: 48000 });
  writeFileSync(sound, 'not a sound');
  assert.deepEqual(await readAudioFacts(sound, 11), {});
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('Media tests passed.');
