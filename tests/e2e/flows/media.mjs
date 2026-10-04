// Videos and sounds open in a tab of their own, played from the server by Range requests
// (media-page.ts, media-serve.ts): a video plays, Space is one toggle, it seeks with 206 answers,
// loops and changes speed; switching to a text file pauses it; a sound draws its waveform (small
// early, tall late as it gets louder), plays and seeks where clicked; one that is not a sound says
// so; a rename is followed and a delete closes the tab, the old names forgotten; made-up names and
// paths are refused. The WebM is tests/e2e/fixtures/clip.webm (VP9 and Opus, 320 x 240, 4 s); the
// WAV is made here. (gs-media.mjs, which makes many more formats with ffmpeg)
import fs from 'node:fs';
import path from 'node:path';
import { e2e, glistApp, repo } from '../common.mjs';

// Three seconds of 440 Hz, stereo, 16-bit at 44.1 kHz, louder as it goes.
const wav = (seconds = 3, rate = 44100, channels = 2) => {
  const frames = seconds * rate;
  const data = Buffer.alloc(frames * channels * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / rate;
    const value = Math.round((0.1 + 0.85 * time / seconds) * Math.sin(2 * Math.PI * 440 * time) * 32767);
    for (let channel = 0; channel < channels; channel += 1) data.writeInt16LE(value, (frame * channels + channel) * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

await e2e({
  setup: (w) => {
    const app = glistApp(w, 'MediaApp', { 'assets/broken.mp3': 'this is not a sound' });
    fs.copyFileSync(path.join(repo, 'tests', 'e2e', 'fixtures', 'clip.webm'), `${app}/assets/clip.webm`);
    fs.writeFileSync(`${app}/assets/tone.wav`, wav());
    fs.writeFileSync(`${app}/assets/sfx.wav`, wav(1));
  },
}, async (t) => {
  const { page } = t;
  const app = t.project('MediaApp');
  const assets = `${app}/assets`;
  page.setDefaultTimeout(10000);
  // The media requests, as the page sent them and the server answered.
  const requests = [];
  page.on('response', (response) => {
    if (response.url().includes('/media/')) requests.push({ status: response.status(), contentRange: response.headers()['content-range'] });
  });
  const shown = '.readme-view:not([hidden])';
  const facts = () => page.locator(`${shown} .media-facts`).innerText().catch(() => '');
  const status = () => page.locator(`${shown} .media-status`).innerText().catch(() => '');
  const player = () => page.locator(`${shown} .media-video, ${shown} .media-audio`);
  const open = async (file) => { await (await t.reveal(file)).dblclick(); await page.locator(`.editor-tab.active[data-path="${file}"]`).waitFor(); };
  const ready = () => page.waitForFunction((selector) => { const media = document.querySelector(selector); return media && media.readyState >= 1; },
    `${shown} .media-video, ${shown} .media-audio`, { timeout: 8000 }).then(() => true, () => false);
  const state = () => player().evaluate((media) => ({ paused: media.paused, time: media.currentTime, duration: media.duration, loop: media.loop, rate: media.playbackRate, src: media.currentSrc, error: media.error?.code ?? null }));
  const seconds = (text) => Number((/([\d.]+) sec/.exec(text) ?? [])[1] ?? NaN);
  const fetchStatus = (url) => page.evaluate((target) => fetch(target).then((response) => response.status, () => 'refused'), url);
  await t.openProject('MediaApp');

  // A video.
  await open(`${assets}/clip.webm`);
  await t.eventually('a WebM opens in a tab of its own, in a player', () => page.locator(`${shown} .media-page.video video[controls]`).count(), (count) => count === 1);
  t.check('not as text', !(await page.locator('#editor-host').evaluate((host) => host.classList.contains('visible'))));
  t.check('its player loads', await ready());
  await t.eventually('facts: format, size, length and bytes', facts, (text) => text.startsWith('WebM · 320 × 240 · ') && Math.abs(seconds(text) - 4) < 0.1 && /· [\d.]+ kB$/.test(text));
  t.check('the page has the keys when it opens', await page.evaluate(() => document.activeElement?.classList.contains('media-page')));
  await page.keyboard.press('Space');
  await t.eventually('Space plays it, and it moves on', state, (now) => !now.paused && now.time > 0.3);
  await page.keyboard.press('Space');
  await t.eventually('Space again pauses it: one press, one toggle', state, (now) => now.paused);
  await player().evaluate((media) => new Promise((resolve) => { media.addEventListener('seeked', resolve, { once: true }); media.currentTime = 3; }));
  t.check('it seeks', Math.abs((await state()).time - 3) < 0.1, await state());
  t.check('its bytes come in Range requests answered 206', requests.length > 0 && requests.every((each) => each.status === 206 && /^bytes \d+-\d+\/\d+$/.test(each.contentRange ?? '')), requests);
  await page.locator(`${shown} .media-tool`, { hasText: 'Loop' }).click();
  await t.eventually('Loop loops it', async () => (await state()).loop && await page.locator(`${shown} .media-tool[aria-pressed="true"]`).count() === 1, Boolean);
  await t.choose(`${shown} .select-button.media-speed`, '1.5×');
  t.check('Speed plays it faster', (await state()).rate === 1.5, await state());
  // The speed's menu took the keys; the page gets them back.
  await page.locator(`${shown} .media-page`).focus();
  await page.keyboard.press('Space');
  await t.eventually('playing again', state, (now) => !now.paused);
  await t.openFile(`${app}/src/main.cpp`);
  await t.eventually('switched to a text file, the video pauses', () => page.evaluate(() => document.querySelector('.media-video')?.paused), (paused) => paused === true);

  // A sound: its waveform, louder as it goes; it plays; a click plays from there.
  await open(`${assets}/tone.wav`);
  t.check('a WAV opens in a player with a waveform', await ready() && await page.locator(`${shown} .media-page.audio canvas.media-wave-canvas`).count() === 1);
  await t.eventually('facts: format, length, rate, channels and bytes', facts, (text) => text.startsWith('WAV · ') && Math.abs(seconds(text) - 3) < 0.1 && text.includes('· 44.1 kHz · Stereo · '));
  const wave = () => page.locator(`${shown} canvas.media-wave-canvas`).evaluate((canvas) => {
    const { width, height } = canvas;
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    // How tall the drawing is at a column, and its colour there.
    const column = (x) => {
      let top = height; let bottom = 0;
      for (let y = 0; y < height; y += 1) if (pixels[(y * width + x) * 4 + 3] > 0) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
      const middle = (Math.floor(height / 2) * width + x) * 4;
      return { span: Math.max(0, bottom - top), color: [...pixels.slice(middle, middle + 3)].join(',') };
    };
    return { width, height, early: column(Math.floor(width * 0.1)), late: column(Math.floor(width * 0.9)), mid: column(Math.floor(width * 0.5)) };
  });
  let drawn = await t.settle(wave, (value) => value.late.span > value.height * 0.6, 8000);
  t.check('the waveform is drawn, small early and tall late as the sound gets louder', drawn.late.span > drawn.height * 0.6 && drawn.early.span < drawn.late.span * 0.4, drawn);
  const unplayed = drawn.mid.color;
  await page.keyboard.press('Space');
  const playing = await t.settle(state, (now) => now.time > 1.6, 4000);
  drawn = await wave();
  t.check('Space plays it, and the played part changes colour as the playhead moves', !playing.paused && playing.time > 1.5 && drawn.mid.color !== unplayed, { playing, unplayed, now: drawn.mid.color });
  await page.keyboard.press('Space');
  const area = await page.locator(`${shown} canvas.media-wave-canvas`).boundingBox();
  await page.mouse.click(area.x + area.width * 0.25, area.y + area.height / 2);
  await t.eventually('a click on the waveform plays from there', state, (now) => Math.abs(now.time - now.duration * 0.25) < 0.15);
  await open(`${assets}/broken.mp3`);
  await t.eventually('a sound that is not one: said to be unplayable', async () => ({ status: await status(), players: await player().count() }),
    (value) => value.status === 'This sound\'s format cannot be played here.' && value.players === 0, 8000);

  // Renamed, its tab follows and plays from its new name; deleted, its tab closes.
  await open(`${assets}/sfx.wav`);
  await ready();
  const before = (await state()).src;
  await (await t.reveal(`${assets}/sfx.wav`)).click();
  await page.keyboard.press('F2');
  await page.fill('#input-dialog-value', 'beep.wav');
  await page.keyboard.press('Enter');
  await page.locator(`.editor-tab[data-path="${assets}/beep.wav"]`).first().click();
  const loadedAgain = await ready();
  await t.eventually('renamed, its tab follows and plays the file under its new name', async () => ({ old: await page.locator(`.editor-tab[data-path="${assets}/sfx.wav"]`).count(), ...(await state()) }),
    (value) => fs.existsSync(`${assets}/beep.wav`) && value.old === 0 && loadedAgain && value.src.endsWith('/beep.wav') && value.error === null);
  t.check('its old name is forgotten', await fetchStatus(before) === 404);
  const renamed = (await state()).src;
  await (await t.reveal(`${assets}/beep.wav`)).click();
  await page.keyboard.press('Delete');
  await t.confirm();
  await t.eventually('deleted, its tab closes', async () => !fs.existsSync(`${assets}/beep.wav`) && await page.locator(`.editor-tab[data-path="${assets}/beep.wav"]`).count() === 0, Boolean);
  t.check('and its name is forgotten', await fetchStatus(renamed) === 404);

  // Names made up, and paths: refused.
  t.check('a made-up name is not served', await fetchStatus(`/media/${'0'.repeat(32)}/clip.webm`) === 404);
  t.check('nor a path', await fetchStatus(`/media/${encodeURIComponent(`${assets}/clip.webm`)}`) === 404 && await fetchStatus('/media/..%2F..%2Fetc%2Fpasswd') === 404);
});
