/*!
 * Voicy Bird — microphone level meter + tiny synthesized sound effects.
 * Plain Web Audio API, no dependencies. Exposes window.VB.MicMeter / VB.Sfx.
 */
(function (global) {
  'use strict';

  const VB = global.VB || (global.VB = {});
  const AudioCtx = global.AudioContext || global.webkitAudioContext;

  /** Lowest level we ever report (digital silence). */
  const MIN_DB = -70;

  /* ------------------------------------------------------------------ *
   * Shared AudioContext
   *
   * Browsers only let an AudioContext run if it was created (or resumed)
   * inside a user gesture, so we create it lazily and re-resume it every
   * time somebody asks for it.  This is the bug that killed the original
   * p5.sound build: the context stayed "suspended" forever.
   * ------------------------------------------------------------------ */
  let sharedCtx = null;

  function getAudioContext() {
    if (!AudioCtx) return null;
    if (!sharedCtx) sharedCtx = new AudioCtx();
    if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
    return sharedCtx;
  }

  /* ------------------------------------------------------------------ *
   * MicMeter — RMS loudness of the microphone in dBFS
   * ------------------------------------------------------------------ */
  class MicMeter {
    constructor() {
      this.stream = null;
      this.source = null;
      this.analyser = null;
      this.buf = null;
      this.byteBuf = null;
      this.enabled = false;
      /** Smoothed level (instant attack, ~80 ms release) in dBFS. */
      this.db = MIN_DB;
      /** Un-smoothed level of the last analysis window. */
      this.rawDb = MIN_DB;
      this.releaseSeconds = 0.08;
      this.onEnded = null;
    }

    static get MIN_DB() { return MIN_DB; }

    static get supported() {
      const nav = global.navigator;
      return !!(AudioCtx && nav && nav.mediaDevices && nav.mediaDevices.getUserMedia);
    }

    /** Ask for the microphone. Rejects with the getUserMedia error if refused. */
    async start() {
      if (this.enabled) return;
      if (!MicMeter.supported) {
        const err = new Error('getUserMedia is not available');
        err.name = 'NotSupportedError';
        throw err;
      }
      const ctx = getAudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,   // keeps our own sound effects out of the meter
          noiseSuppression: false,  // suppression would eat long sustained screams
          autoGainControl: false    // AGC would normalise loud and quiet — the whole game
        },
        video: false
      });
      // If the context was created outside a gesture it may still be suspended.
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

      this.stream = stream;
      this.source = ctx.createMediaStreamSource(stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;               // ~21 ms window at 48 kHz
      this.analyser.smoothingTimeConstant = 0;    // we smooth ourselves
      this.source.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      this.byteBuf = null;
      this.enabled = true;

      const track = stream.getAudioTracks()[0];
      if (track) {
        track.addEventListener('ended', () => {
          this.stop();
          if (this.onEnded) this.onEnded();
        });
      }
    }

    stop() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.source) { try { this.source.disconnect(); } catch (e) { /* noop */ } }
      this.stream = this.source = this.analyser = null;
      this.enabled = false;
      this.db = this.rawDb = MIN_DB;
    }

    /**
     * Sample the microphone. Call once per animation frame.
     * @param {number} dt seconds since the previous call
     * @returns {number} smoothed level in dBFS
     */
    update(dt) {
      if (!this.enabled) return MIN_DB;

      let sum = 0;
      const a = this.analyser;
      if (typeof a.getFloatTimeDomainData === 'function') {
        a.getFloatTimeDomainData(this.buf);
        for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      } else {
        // Old Safari: 8-bit samples centred on 128.
        if (!this.byteBuf) this.byteBuf = new Uint8Array(a.fftSize);
        a.getByteTimeDomainData(this.byteBuf);
        for (let i = 0; i < this.byteBuf.length; i++) {
          const v = (this.byteBuf[i] - 128) / 128;
          sum += v * v;
        }
      }
      const rms = Math.sqrt(sum / a.fftSize);
      const db = rms > 0 ? Math.max(MIN_DB, 20 * Math.log10(rms)) : MIN_DB;
      this.rawDb = db;

      if (db >= this.db) {
        this.db = db;                                        // instant attack
      } else {
        const k = 1 - Math.exp(-dt / this.releaseSeconds);   // smooth release
        this.db += (db - this.db) * k;
      }
      return this.db;
    }
  }

  /**
   * Map a sensitivity setting (0 = needs a shout, 1 = a whisper lifts) and the
   * measured room noise to the dB range that drives the bird.
   * Anything below lowDb is "quiet" (bird sinks), highDb is full lift.
   */
  MicMeter.thresholds = function thresholds(sensitivity, ambientDb) {
    const s = Math.min(1, Math.max(0, Number(sensitivity) || 0));
    const preferred = -48 + (1 - s) * 30;             // -48 dB … -18 dB
    const floor = (typeof ambientDb === 'number' ? ambientDb : MIN_DB) + 7;
    const lowDb = Math.min(-12, Math.max(preferred, floor));
    const highDb = Math.max(lowDb + 8, Math.min(lowDb + 22, -2));
    return { lowDb, highDb };
  };

  /* ------------------------------------------------------------------ *
   * Sfx — three synthesized blips, no audio files needed
   * ------------------------------------------------------------------ */
  class Sfx {
    constructor() { this.enabled = true; }

    _tone(freq, dur, type, gain, slideTo) {
      if (!this.enabled) return;
      const ctx = getAudioContext();
      if (!ctx || ctx.state !== 'running') return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    score() { this._tone(880, 0.09, 'square', 0.05, 1320); }
    hit()   { this._tone(180, 0.28, 'sawtooth', 0.12, 55); }
    start() { this._tone(520, 0.12, 'triangle', 0.06, 780); }
    best()  { this._tone(660, 0.18, 'triangle', 0.07, 1320); }
  }

  VB.getAudioContext = getAudioContext;
  VB.MicMeter = MicMeter;
  VB.Sfx = Sfx;
})(typeof window !== 'undefined' ? window : globalThis);
