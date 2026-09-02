'use strict';
/**
 * Unit tests for the dependency-free modules (run with `npm test`).
 * The browser-only game loop is covered by the headless smoke test in test/e2e.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModules() {
  const sandbox = { console, setTimeout, clearTimeout, Date, Math };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['audio.js', 'speech.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
    vm.runInContext(src, sandbox, { filename: f });
  }
  return sandbox.VB;
}

const VB = loadModules();

test('modules load without a DOM and expose their API', () => {
  assert.equal(typeof VB.parseCommand, 'function');
  assert.equal(typeof VB.VoiceCommands, 'function');
  assert.equal(typeof VB.MicMeter, 'function');
  assert.equal(typeof VB.Sfx, 'function');
  assert.equal(VB.VoiceCommands.supported, false, 'no SpeechRecognition in node');
  assert.equal(VB.MicMeter.supported, false, 'no getUserMedia in node');
});

test('parseCommand: exact words', () => {
  assert.equal(VB.parseCommand('play'), 'play');
  assert.equal(VB.parseCommand('stop'), 'pause');
  assert.equal(VB.parseCommand('continue'), 'resume');
  assert.equal(VB.parseCommand('restart'), 'restart');
  assert.equal(VB.parseCommand('new game'), 'restart');
});

test('parseCommand: tolerant of case, punctuation and filler words', () => {
  assert.equal(VB.parseCommand('Play.'), 'play');
  assert.equal(VB.parseCommand('STOP!'), 'pause');
  assert.equal(VB.parseCommand('okay please stop the game'), 'pause');
  assert.equal(VB.parseCommand('  Continue  '), 'resume');
  assert.equal(VB.parseCommand("let's start"), 'play');
  assert.equal(VB.parseCommand('hold on'), 'pause');
});

test('parseCommand: latest command in the utterance wins', () => {
  assert.equal(VB.parseCommand('play no wait stop'), 'pause');
  assert.equal(VB.parseCommand('stop... actually continue'), 'resume');
});

test('parseCommand: whole words only, no false positives', () => {
  assert.equal(VB.parseCommand('display'), null, '"display" must not match "play"');
  assert.equal(VB.parseCommand('playground'), null);
  assert.equal(VB.parseCommand('unstoppable'), null);
  assert.equal(VB.parseCommand('hello there'), null);
  assert.equal(VB.parseCommand(''), null);
  assert.equal(VB.parseCommand(null), null);
});

test('MicMeter.thresholds: sensitivity moves the lift zone, ambient noise raises the floor', () => {
  const shout = VB.MicMeter.thresholds(0, VB.MicMeter.MIN_DB);
  const whisper = VB.MicMeter.thresholds(1, VB.MicMeter.MIN_DB);
  assert.ok(whisper.lowDb < shout.lowDb, 'more sensitive → lower threshold');
  assert.ok(shout.highDb > shout.lowDb && whisper.highDb > whisper.lowDb);

  const noisyRoom = VB.MicMeter.thresholds(1, -40);
  assert.ok(noisyRoom.lowDb >= -33, 'floor sits above ambient noise');
  assert.ok(noisyRoom.lowDb <= -12 && noisyRoom.highDb <= -2, 'never asks for the impossible');

  const clamped = VB.MicMeter.thresholds(0.5, -5);
  assert.ok(clamped.highDb - clamped.lowDb >= 8, 'range never collapses');
});

test('VoiceCommands without SpeechRecognition reports unsupported and never throws', () => {
  const statuses = [];
  const vc = new VB.VoiceCommands({ onStatus: (s) => statuses.push(s) });
  assert.equal(vc.status, 'unsupported');
  vc.start();
  vc.stop();
  assert.deepEqual(statuses, ['unsupported']);
  assert.equal(vc.status, 'unsupported', 'stop() must not pretend voice is merely idle');
});

/* ------------------------------------------------------------------ *
 * VoiceCommands against a mocked SpeechRecognition
 * ------------------------------------------------------------------ */
function loadWithMockRecognition() {
  const instances = [];
  class FakeRecognition {
    constructor() {
      this.started = false;
      this.aborted = false;
      instances.push(this);
    }
    start() {
      if (this.started) { const e = new Error('already started'); e.name = 'InvalidStateError'; throw e; }
      this.started = true;
      if (this.onstart) this.onstart({});
    }
    abort() { this.aborted = true; this.started = false; if (this.onend) this.onend(); }
    stop() { this.abort(); }
    /* test helpers */
    emit(transcript, isFinal, index) {
      const results = [];
      results[index || 0] = Object.assign([{ transcript, confidence: 0.9 }], { isFinal: !!isFinal });
      this.onresult({ resultIndex: index || 0, results });
    }
    end() { this.started = false; if (this.onend) this.onend(); }
    error(code) { if (this.onerror) this.onerror({ error: code }); }
  }
  const sandbox = { console, setTimeout, clearTimeout, Date, Math, SpeechRecognition: FakeRecognition };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'speech.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'speech.js' });
  return { VB: sandbox.VB, instances };
}

test('VoiceCommands fires parsed commands and ignores interim→final duplicates', () => {
  const { VB: V, instances } = loadWithMockRecognition();
  const heard = [];
  const vc = new V.VoiceCommands({ onCommand: (c, t) => heard.push([c, t]) });
  vc.start();
  assert.equal(vc.status, 'listening');
  const rec = instances[0];
  assert.equal(rec.continuous, true);
  assert.equal(rec.interimResults, true);

  rec.emit('sto', false, 0);          // interim, not a command yet
  rec.emit('stop', false, 0);         // interim: fire now for responsiveness
  rec.emit('stop', true, 0);          // final for the same slot: must not double-fire
  assert.deepEqual(heard, [['pause', 'stop']]);
  vc.stop();
});

test('VoiceCommands debounces identical commands but lets different ones through', () => {
  const { VB: V, instances } = loadWithMockRecognition();
  const heard = [];
  const vc = new V.VoiceCommands({ onCommand: (c) => heard.push(c) });
  vc.start();
  const rec = instances[0];
  rec.emit('play', true, 0);
  rec.emit('play', true, 1);          // < debounce window → dropped
  rec.emit('stop', true, 2);          // different command → accepted
  assert.deepEqual(heard, ['play', 'pause']);
  vc.stop();
});

test('VoiceCommands restarts after the browser ends a session (the original bug)', async () => {
  const { VB: V, instances } = loadWithMockRecognition();
  const statuses = [];
  const vc = new V.VoiceCommands({ onStatus: (s) => statuses.push(s) });
  vc.start();
  assert.equal(instances.length, 1);
  instances[0].emit('play', true, 0);
  instances[0].end();                          // Chrome does this after silence
  assert.equal(vc.active, false);
  await new Promise((r) => setTimeout(r, 400)); // first backoff step is 250 ms
  assert.equal(instances.length, 2, 'a fresh recognizer was started');
  assert.equal(vc.status, 'listening');
  vc.stop();
  assert.equal(instances[1].aborted, true);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(instances.length, 2, 'stop() really stops the restart loop');
});

test('VoiceCommands gives up after a permission error instead of looping', async () => {
  const { VB: V, instances } = loadWithMockRecognition();
  const vc = new V.VoiceCommands({});
  vc.start();
  instances[0].error('not-allowed');
  instances[0].end();
  assert.equal(vc.status, 'denied');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(instances.length, 1, 'no restart after a fatal error');
});

test('VoiceCommands ignores events from a recognizer it has already replaced', async () => {
  const { VB: V, instances } = loadWithMockRecognition();
  const heard = [];
  const vc = new V.VoiceCommands({ onCommand: (c) => heard.push(c) });
  vc.start();
  const old = instances[0];
  vc.stop();
  vc.start();
  assert.equal(instances.length, 2);
  old.emit('play', true, 0);            // late event from the abandoned instance
  assert.deepEqual(heard, [], 'stale recognizer must not fire commands');
  instances[1].emit('play', true, 0);
  assert.deepEqual(heard, ['play']);
  vc.stop();
});

test('VoiceCommands does not back off after quiet sessions ("no-speech")', async () => {
  const { VB: V, instances } = loadWithMockRecognition();
  const vc = new V.VoiceCommands({});
  vc.start();
  // Chrome ends a silent session with a "no-speech" error after ~8 s. Simulate
  // that a few times in a row; each restart must stay on the fastest schedule.
  for (let i = 0; i < 3; i++) {
    const rec = instances[instances.length - 1];
    vc._sessionStart -= 2000;          // pretend the session lived 2 s
    rec.error('no-speech');
    rec.end();
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(instances.length, i + 2, `restart #${i + 1} should happen within 250 ms`);
  }
  vc.stop();
});
