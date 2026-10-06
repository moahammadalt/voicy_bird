const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const gameSource = fs.readFileSync(
  require('node:path').join(__dirname, '..', 'js', 'game.js'),
  'utf8'
);

function createGame() {
  let nextTimerId = 1;
  let cookie = '';
  const intervals = new Map();
  const timeouts = new Map();
  const context2d = {
    clearRect() {},
    drawImage() {},
    fillRect() {},
    fillText() {},
  };

  class Canvas {
    constructor() {
      this.listeners = {};
      this.parentNode = null;
    }

    getContext() {
      return context2d;
    }

    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }

    click() {
      this.listeners.click();
    }
  }

  const body = {
    childNodes: [],
    insertBefore(node, before) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }

      const index = before ? this.childNodes.indexOf(before) : -1;
      if (index < 0) {
        this.childNodes.push(node);
      } else {
        this.childNodes.splice(index, 0, node);
      }
      node.parentNode = this;
    },
    removeChild(node) {
      const index = this.childNodes.indexOf(node);
      if (index >= 0) {
        this.childNodes.splice(index, 1);
      }
      node.parentNode = null;
    },
  };

  const document = {
    body,
    createElement: () => new Canvas(),
    querySelector: selector => (
      selector === 'canvas' ? body.childNodes[0] || null : null
    ),
  };

  Object.defineProperty(document, 'cookie', {
    get() {
      return cookie;
    },
    set(value) {
      cookie = value.split(';', 1)[0];
    },
  });

  class SpeechRec {
    constructor() {
      this.resultString = '';
    }

    start() {}
  }

  class AudioIn {
    start() {}

    getLevel() {
      return 0;
    }
  }

  const setIntervalMock = callback => {
    const id = nextTimerId++;
    intervals.set(id, callback);
    return id;
  };
  const clearIntervalMock = id => intervals.delete(id);
  const setTimeoutMock = callback => {
    const id = nextTimerId++;
    timeouts.set(id, callback);
    return id;
  };
  const clearTimeoutMock = id => timeouts.delete(id);

  const sandbox = {
    clearInterval: clearIntervalMock,
    clearTimeout: clearTimeoutMock,
    console,
    decodeURIComponent,
    document,
    Image: function Image() {},
    Math,
    Number,
    p5: { AudioIn, SpeechRec },
    setInterval: setIntervalMock,
    setTimeout: setTimeoutMock,
    window: { setInterval: setIntervalMock },
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(gameSource, sandbox, { filename: 'js/game.js' });

  return {
    body,
    intervals,
    runNextTimeout() {
      const next = timeouts.entries().next().value;
      assert.ok(next, 'expected a pending timeout');
      const [id, callback] = next;
      timeouts.delete(id);
      callback();
    },
    sandbox,
    timeouts,
  };
}

test('a new game can start after the previous game is lost', () => {
  const game = createGame();
  const { body, sandbox } = game;

  sandbox.startGame();
  assert.equal(body.childNodes[0], sandbox.game_intro.canvas);

  sandbox.game_intro.canvas.click();
  assert.equal(body.childNodes[0], sandbox.game_area.canvas);
  assert.equal(sandbox.start_playing, true);

  sandbox.obstacles.push({
    height: 50,
    width: 50,
    x: sandbox.bird.x,
    y: sandbox.bird.y,
  });
  sandbox.updateGameArea();
  assert.equal(sandbox.is_stoped, true);
  assert.equal(game.timeouts.size, 1);

  game.runNextTimeout();
  assert.equal(body.childNodes[0], sandbox.game_intro.canvas);
  assert.equal(sandbox.obstacles.length, 0);

  sandbox.game_intro.canvas.click();
  assert.equal(body.childNodes[0], sandbox.game_area.canvas);
  assert.equal(sandbox.start_playing, true);
});

test('pausing and resuming does not create duplicate game loops', () => {
  const game = createGame();
  const { body, intervals, sandbox } = game;

  sandbox.startGame();
  sandbox.game_intro.canvas.click();
  assert.equal(intervals.size, 2, 'audio monitor and game loop should be active');

  body.childNodes[0].click();
  assert.equal(sandbox.game_area.interval, null);
  assert.equal(intervals.size, 1, 'only the audio monitor should remain');

  body.childNodes[0].click();
  assert.notEqual(sandbox.game_area.interval, null);
  assert.equal(intervals.size, 2, 'resume should create one game loop');
});
