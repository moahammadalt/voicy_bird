/*!
 * Voicy Bird — voice commands on top of the Web Speech API.
 * Plain browser API, no dependencies. Exposes window.VB.VoiceCommands / VB.parseCommand.
 *
 * Why not p5.speech?  The bundled 2015 build only looked for the webkit-prefixed
 * constructor, compared transcripts with `==` (so "Play." or "stop it" never
 * matched) and never restarted recognition after Chrome ends a session, which it
 * does after a few seconds of silence.  Voice control silently died a minute in.
 */
(function (global) {
  'use strict';

  const VB = global.VB || (global.VB = {});
  const SR = global.SpeechRecognition || global.webkitSpeechRecognition;

  /** Command vocabulary. Order matters only for ties at the same position. */
  const COMMANDS = [
    { name: 'restart', re: /\b(restart|new game|again|retry|reset|replay)\b/g },
    { name: 'resume',  re: /\b(continue|resume|unpause|carry on|keep going)\b/g },
    { name: 'pause',   re: /\b(stop|pause|wait|halt|freeze|hold on)\b/g },
    { name: 'play',    re: /\b(play|start|go|begin)\b/g }
  ];

  /**
   * Find the command in a transcript.  When several appear ("play… no, stop")
   * the most recently spoken one wins.
   * @param {string} text
   * @returns {string|null} 'play' | 'pause' | 'resume' | 'restart' | null
   */
  function parseCommand(text) {
    if (!text) return null;
    const t = String(text).toLowerCase();
    let best = null;
    for (const c of COMMANDS) {
      c.re.lastIndex = 0;
      let m;
      let last = -1;
      while ((m = c.re.exec(t)) !== null) {
        last = m.index;
        if (m[0].length === 0) c.re.lastIndex++;
      }
      if (last > -1 && (best === null || last > best.index)) best = { name: c.name, index: last };
    }
    return best ? best.name : null;
  }

  /** Errors after which restarting would only loop forever. */
  const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported']);

  class VoiceCommands {
    /**
     * @param {object} opts
     * @param {string}   [opts.lang='en-US']
     * @param {Function} [opts.onCommand] (name, transcript)
     * @param {Function} [opts.onStatus]  (status, detail) status ∈ idle|starting|listening|offline|denied|unsupported|error
     * @param {Function} [opts.onHeard]   (transcript, isFinal)
     */
    constructor(opts) {
      const o = opts || {};
      this.lang = o.lang || 'en-US';
      this.onCommand = o.onCommand || function () {};
      this.onStatus = o.onStatus || function () {};
      this.onHeard = o.onHeard || null;
      this.debounceMs = 1200;

      this.rec = null;
      this.wanted = false;
      this.active = false;
      this.fatal = false;
      this.status = SR ? 'idle' : 'unsupported';

      this._fired = new Map();
      this._lastCmd = null;
      this._lastCmdAt = 0;
      this._restarts = 0;
      this._sessionStart = 0;
      this._gotResult = false;
      this._lastError = null;
      this._timer = 0;
    }

    static get supported() { return !!SR; }

    start() {
      if (!SR) { this._setStatus('unsupported', 'no SpeechRecognition'); return; }
      this.wanted = true;
      this.fatal = false;
      this._restarts = 0;
      this._begin();
    }

    stop() {
      this.wanted = false;
      clearTimeout(this._timer);
      this._timer = 0;
      const rec = this.rec;
      this.rec = null;               // events from this instance are ignored from now on
      this.active = false;
      if (rec) {
        try { rec.abort(); } catch (e) { /* not started */ }
      }
      if (SR) this._setStatus('idle');
    }

    _setStatus(status, detail) {
      if (status === this.status && !detail) return;
      this.status = status;
      this.onStatus(status, detail);
    }

    _begin() {
      if (!this.wanted || this.active || this.fatal) return;
      clearTimeout(this._timer);
      this._timer = 0;

      const rec = new SR();
      this.rec = rec;
      rec.lang = this.lang;
      rec.continuous = true;
      rec.interimResults = true;      // react while the word is still being spoken
      rec.maxAlternatives = 1;

      this._fired.clear();
      this._gotResult = false;
      this._lastError = null;
      this._sessionStart = Date.now();

      // Every handler ignores events from a recognizer we have already replaced.
      rec.onstart = () => {
        if (this.rec !== rec) return;
        this.active = true;
        // After a network error stay "offline" until something is actually heard.
        if (this.status !== 'offline') this._setStatus('listening');
      };

      rec.onresult = (e) => {
        if (this.rec !== rec) return;
        this._gotResult = true;
        this._restarts = 0;
        this._setStatus('listening');
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const alt = res && res[0];
          const transcript = alt && alt.transcript ? alt.transcript.trim() : '';
          if (!transcript) continue;
          if (this.onHeard) this.onHeard(transcript, !!res.isFinal);

          const cmd = parseCommand(transcript);
          if (!cmd) continue;
          // One result slot grows from interim → final; don't fire twice for it.
          if (this._fired.get(i) === cmd) continue;
          this._fired.set(i, cmd);

          const now = Date.now();
          if (cmd === this._lastCmd && now - this._lastCmdAt < this.debounceMs) continue;
          this._lastCmd = cmd;
          this._lastCmdAt = now;
          this.onCommand(cmd, transcript);
        }
      };

      rec.onerror = (e) => {
        if (this.rec !== rec) return;
        const code = e && e.error ? e.error : 'unknown';
        this._lastError = code;
        if (FATAL_ERRORS.has(code)) {
          this.fatal = true;
          this.wanted = false;
          this._setStatus('denied', code);
        } else if (code === 'network') {
          this._setStatus('offline', code);
        } else if (code !== 'no-speech' && code !== 'aborted') {
          this._setStatus('error', code);
        }
        // 'onend' always follows and decides whether to restart.
      };

      rec.onend = () => {
        if (this.rec !== rec) return;
        this.active = false;
        if (!this.wanted || this.fatal) {
          if (!this.fatal) this._setStatus('idle');
          return;
        }
        // Chrome ends continuous sessions after a while (and after silence);
        // start a fresh one. Only back off when sessions die abnormally —
        // a quiet room ("no-speech") is healthy and must stay responsive.
        const lived = Date.now() - this._sessionStart;
        const err = this._lastError;
        const benign = err === null || err === 'no-speech' || err === 'aborted';
        const healthy = this._gotResult || (benign && lived > 1500);
        if (healthy) this._restarts = 0;
        else this._restarts++;
        let delay = Math.min(8000, 250 * Math.pow(2, this._restarts));
        if (this.status === 'offline') delay = Math.max(delay, 3000);
        if (delay >= 1000 && this.status !== 'offline') this._setStatus('starting');
        this._timer = setTimeout(() => this._begin(), delay);
      };

      // A quick restart between sessions keeps showing "listening"; anything
      // else (first start, long backoff) is visibly "starting".
      if (this.status !== 'offline' && this.status !== 'listening') this._setStatus('starting');
      try {
        rec.start();
      } catch (err) {
        // InvalidStateError: a previous instance is still shutting down.
        this._timer = setTimeout(() => this._begin(), 500);
      }
    }
  }

  VB.parseCommand = parseCommand;
  VB.VoiceCommands = VoiceCommands;
})(typeof window !== 'undefined' ? window : globalThis);
