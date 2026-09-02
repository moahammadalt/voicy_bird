'use strict';
/**
 * Headless end-to-end smoke test.
 *
 *   npm run test:e2e
 *
 * Needs puppeteer (not a project dependency — install it ad hoc):
 *   npm i -D puppeteer            # downloads a Chrome build
 *   npx puppeteer browsers install chrome
 *
 * Optional environment:
 *   VB_URL       page to test (default: serves ./ on a free port itself)
 *   VB_CHROME    path to a Chrome/Chromium binary
 *   VB_SHOTS     directory for screenshots (default: no screenshots)
 *
 * The microphone is provided by Chrome's fake device, so the real audio path
 * (getUserMedia → AnalyserNode) is exercised even though nobody is screaming.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  console.error('puppeteer is not installed. Run: npm i -D puppeteer');
  process.exit(2);
}

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serveStatic() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/index.html` }));
  });
}

async function main() {
  const shots = process.env.VB_SHOTS;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const local = process.env.VB_URL ? null : await serveStatic();
  const url = process.env.VB_URL || local.url;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.VB_CHROME || undefined,
    args: ['--no-sandbox', '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const failures = [];
  const logs = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') logs.push('[console.error] ' + m.text()); });
    // Resource failures for the optional webfont (offline CI) are not bugs.
    page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)\.com/.test(r.url())) logs.push('[requestfailed] ' + r.url()); });
    await page.setViewport({ width: 900, height: 700 });
    await page.goto(url, { waitUntil: 'load' });
    await sleep(400);

    const S = () => page.evaluate(() => ({
      state: VB.game.state(), score: VB.game.score(), best: VB.game.best(),
      y: Math.round(VB.game.data.bird.y), pipes: VB.game.data.pipes.length
    }));
    const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
    const check = async (name, fn) => {
      try { await fn(); console.log('  ok   ' + name); } catch (err) { failures.push(name); console.log('  FAIL ' + name + '\n       ' + err.message); }
    };

    console.log('Voicy Bird e2e @ ' + url);

    await check('title screen shows', async () => {
      assert.equal((await S()).state, 'title');
      assert.equal(await page.$eval('#ov-title', (el) => el.hidden), false);
      await shot('01-title');
    });

    await check('keyboard start → ready → playing', async () => {
      await page.click('#btn-start-kb');
      await sleep(200);
      assert.equal((await S()).state, 'ready');
      await shot('02-ready');
      await page.keyboard.down('Space');
      await sleep(200);
      assert.equal((await S()).state, 'playing');
    });

    await check('holding Space lifts the bird, releasing drops it', async () => {
      const a = (await S()).y;
      await sleep(600);
      const b = (await S()).y;
      await page.keyboard.up('Space');
      await sleep(400);                 // momentum: the bird keeps climbing briefly
      const c = (await S()).y;
      await sleep(500);
      const d = (await S()).y;
      assert.ok(b < a - 30, `should rise while held (${a} → ${b})`);
      assert.ok(d > c + 30, `should fall after release (${c} → ${d})`);
    });

    await check('autopilot scores points and pipes recycle', async () => {
      await page.evaluate(() => {
        window.__ap = setInterval(() => {
          const g = VB.game.data;
          if (g.state !== 'playing') return;
          const b = g.bird;
          const p = g.pipes.find((q) => q.x + 70 > b.x - 25);
          g.held = b.y > (p ? p.gapY : 200) - 2;
        }, 8);
      });
      const t0 = Date.now();
      let s;
      do { await sleep(500); s = await S(); } while (s.state === 'playing' && s.score < 5 && Date.now() - t0 < 40000);
      await page.evaluate(() => { clearInterval(window.__ap); VB.game.data.held = false; });
      assert.equal(s.state, 'playing', 'autopilot should survive');
      assert.ok(s.score >= 5, 'expected ≥5 points, got ' + s.score);
      assert.ok(s.pipes <= 6, 'pipes should be recycled, have ' + s.pipes);
      await shot('03-playing');
    });

    await check('P pauses, voice "continue" resumes, voice "stop" pauses', async () => {
      await page.keyboard.press('KeyP');
      await sleep(100);
      assert.equal((await S()).state, 'paused');
      await shot('04-paused');
      await page.evaluate(() => VB.game.onVoiceCommand('resume', 'continue'));
      await sleep(100);
      assert.equal((await S()).state, 'playing');
      await page.evaluate(() => VB.game.onVoiceCommand('pause', 'please stop'));
      await sleep(100);
      assert.equal((await S()).state, 'paused');
      await page.click('#btn-resume');
      await sleep(100);
      assert.equal((await S()).state, 'playing');
    });

    await check('falling ends the game, best score persists', async () => {
      await sleep(3500);
      const s = await S();
      assert.equal(s.state, 'over');
      assert.ok(s.best >= 5 && s.best === s.score, `best ${s.best} should equal score ${s.score}`);
      assert.equal(await page.$eval('#over-ribbon', (el) => el.hidden), false, 'new-best ribbon');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('voicy_bird.best'))), s.best);
      await shot('05-over');
    });

    await check('voice "restart" and "play" drive the flow', async () => {
      await page.evaluate(() => VB.game.onVoiceCommand('restart', 'new game'));
      await sleep(100);
      assert.equal((await S()).state, 'ready');
      await page.evaluate(() => VB.game.onVoiceCommand('play', 'play'));
      await sleep(100);
      assert.equal((await S()).state, 'playing');
      await page.keyboard.press('Escape');
      await sleep(100);
      assert.equal((await S()).state, 'paused');
      await page.click('#btn-menu');
      await sleep(100);
      assert.equal((await S()).state, 'title');
    });

    await check('microphone path: getUserMedia → analyser → lift', async () => {
      await page.click('#btn-mic');
      await sleep(1600);
      const m = await page.evaluate(() => ({ enabled: VB.game.mic.enabled, ctx: VB.getAudioContext().state, label: document.getElementById('mic-label').textContent }));
      assert.equal(m.enabled, true);
      assert.equal(m.ctx, 'running', 'AudioContext must be running after the click');
      assert.equal(m.label, 'Microphone on');
      await page.click('#btn-start-mic');
      await sleep(200);
      assert.equal((await S()).state, 'ready');
      await page.evaluate(() => { VB.game.mic.update = () => -8; }); // simulate a scream
      await sleep(1000);
      const s = await S();
      assert.equal(s.state, 'playing', 'noise should launch the bird');
      assert.ok(s.y < 120, 'bird should be near the top, y=' + s.y);
      await shot('06-scream');
      await page.evaluate(() => { VB.game.mic.update = () => -70; });
      await sleep(800);
      assert.ok((await S()).y > s.y + 40, 'silence should let the bird sink');
    });

    await check('best score survives a reload', async () => {
      await page.reload({ waitUntil: 'load' });
      await sleep(300);
      const best = await page.$eval('#best-title', (el) => Number(el.textContent));
      assert.ok(best >= 5, 'best on title = ' + best);
    });

    await check('no page errors', async () => {
      const real = logs.filter((l) => !/Failed to load resource/.test(l)); // covered by requestfailed above
      assert.deepEqual(real, []);
    });
  } finally {
    await browser.close();
    if (local) local.server.close();
  }

  if (failures.length) {
    console.log(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log('\nall good');
}

main().catch((e) => { console.error(e); process.exit(1); });
