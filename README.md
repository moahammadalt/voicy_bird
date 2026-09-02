# Voicy Bird 🐤

**A Flappy Bird you play with your voice.** Scream to fly, whisper to sink, and say
*"play"*, *"stop"*, *"continue"* or *"restart"* to drive the game hands‑free.

▶ **Play:** https://moahammadalt.github.io/voicy_bird/

Built with the plain **Web Audio API** (microphone loudness) and **Web Speech API**
(voice commands) on an HTML canvas — no frameworks, no build step, no image assets.

## How to play

| Control | Action |
| --- | --- |
| 🎤 Make noise | The louder you are, the harder the bird climbs. Go quiet and it sinks. |
| Say **"play"** / **"start"** | Start a round |
| Say **"stop"** / **"pause"** | Pause |
| Say **"continue"** / **"resume"** | Resume |
| Say **"restart"** / **"new game"** | Start over |
| Hold <kbd>Space</kbd> / <kbd>↑</kbd> / <kbd>W</kbd>, or tap & hold | Fly without a microphone |
| <kbd>P</kbd> / <kbd>Esc</kbd> | Pause · resume |
| <kbd>R</kbd> | Restart |
| <kbd>Enter</kbd> | Start / play again |

Tips

- Use the **Sensitivity** slider if the bird is too eager (whisper) or too lazy (shout).
- **Calibrate** measures your room's background noise so a noisy café doesn't keep the bird airborne.
- Voice commands need an internet connection in Chrome (recognition runs in the cloud); the
  loudness control itself works offline.

## Browser support

- **Chrome / Edge** – everything works (voice commands need the Web Speech API).
- **Firefox / Safari** – loudness flying, keyboard and touch work; the *Voice commands*
  toggle is disabled where speech recognition is unavailable.
- Microphone access requires a **secure context** – `https://` or `localhost`.

## Development

```bash
npm install
npm start          # dev server with live reload → http://localhost:3000
npm test           # unit tests for the voice/audio modules (Node ≥ 18, no browser needed)
```

Any static server works too, e.g. `python3 -m http.server 8000`.

### End‑to‑end smoke test

`test/e2e.js` drives the game in headless Chrome (fake microphone, keyboard and
"voice" commands) and asserts scoring, pause/resume, game over and high‑score persistence.

```bash
npm i -D puppeteer          # not a project dependency; installs a Chrome build
npm run test:e2e
```

## Project layout

```
index.html      markup, overlays, settings dock
css/main.css    styles (responsive, reduced‑motion aware)
js/audio.js     VB.MicMeter (dBFS loudness meter), VB.Sfx (synthesized sounds)
js/speech.js    VB.VoiceCommands (auto‑restarting recognizer), VB.parseCommand
js/game.js      game state, fixed‑step physics, canvas rendering, UI glue
test/           unit tests + headless e2e smoke test
```

## Credits

Original idea and 2018 version by [Mohammad Altenji](https://mohammad-altenji.firebaseapp.com/).
Inspired by Dong Nguyen's *Flappy Bird*.
