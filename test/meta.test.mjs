import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const sandbox = {
  console,
  Number,
  JSON,
  Object,
  Array,
  Set,
  Math,
  String,
  Error,
  Infinity,
  NaN,
  setTimeout: (...args) => globalThis.setTimeout(...args),
  clearTimeout: (...args) => globalThis.clearTimeout(...args)
};
Object.defineProperty(sandbox, 'Date', { get: () => globalThis.Date });
sandbox.globalThis = sandbox;
const context = createContext(sandbox);
for (const name of ['meta.js', 'progress.js']) {
  runInContext(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'), context, { filename: name });
}

const {
  metaKey,
  metaUpdate,
  APP_VERSION,
  SAVE_KEY,
  SLUG,
  backfillMeta,
  loadSave,
  queueMetaUpdate,
  recordMatch
} = sandbox;

const META_KEY = metaKey(SLUG);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function installStorage() {
  const map = new Map();
  sandbox.localStorage = {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    }
  };
  return map;
}

const OLD_SAVE = {
  games_played: 12,
  human_wins: 3,
  hard_wins: 1,
  best_capture: 25,
  best_score: 80,
  cells_captured: 500,
  turns_played: 140,
  wasted_turns: 4,
  powerups_taken: 11,
  bombs_used: 2,
  freezes_used: 1,
  steals_used: 0,
  doubles_used: 1,
  wall_games: 6,
  four_player_games: 2,
  six_color_games: 1,
  big_board_games: 0,
  full_clears: 4,
  legacy_note: 'keep'
};

describe('meta.v1 migration', { concurrency: false }, () => {
  beforeEach(() => {
    installStorage();
    delete sandbox.window;
    delete sandbox.location;
  });

  afterEach(() => {
    mock.timers.reset();
    delete sandbox.window;
    delete sandbox.location;
  });

  test('an old save without the meta key produces a record from that save', () => {
    sandbox.localStorage.setItem(SAVE_KEY, JSON.stringify(OLD_SAVE));

    const record = backfillMeta();

    assert.ok(record);
    assert.equal(record.v, 1);
    assert.equal(record.slug, SLUG);
    assert.equal(record.version, APP_VERSION);
    assert.match(record.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(plain(record.stats), {
      games_played: 12,
      human_wins: 3,
      hard_wins: 1,
      best_capture: 25,
      best_score: 80,
      cells_captured: 500,
      turns_played: 140,
      wasted_turns: 4,
      powerups_taken: 11,
      bombs_used: 2,
      freezes_used: 1,
      steals_used: 0,
      doubles_used: 1,
      wall_games: 6,
      four_player_games: 2,
      six_color_games: 1,
      big_board_games: 0,
      full_clears: 4
    });
    assert.deepEqual(plain(record.logros), [
      'big_wave',
      'first_game',
      'first_win',
      'four_players',
      'full_board',
      'hard_win',
      'power_10',
      'six_colors',
      'ten_games'
    ]);
    assert.deepEqual(Object.keys(record.hitos).sort(), plain(record.logros));
    for (const id of record.logros) {
      assert.equal(record.hitos[id], record.updatedAt);
    }
    const saved = JSON.parse(sandbox.localStorage.getItem(SAVE_KEY));
    assert.equal(saved.legacy_note, 'keep');
    assert.equal(saved.games_played, 12);
  });

  test('backfill does not overwrite an existing meta record', () => {
    const existing = {
      v: 1,
      slug: SLUG,
      version: '0.9.0',
      updatedAt: '2020-01-01T00:00:00.000Z',
      stats: { games_played: 1 },
      logros: ['first_game'],
      hitos: { first_game: '2020-01-01T00:00:00.000Z' }
    };
    const raw = JSON.stringify(existing);
    sandbox.localStorage.setItem(META_KEY, raw);
    sandbox.localStorage.setItem(SAVE_KEY, JSON.stringify(OLD_SAVE));

    const result = backfillMeta();

    assert.equal(result, null);
    assert.equal(sandbox.localStorage.getItem(META_KEY), raw);
    assert.equal(JSON.parse(sandbox.localStorage.getItem(SAVE_KEY)).games_played, 12);
  });

  test('corrupt meta JSON does not crash', () => {
    sandbox.localStorage.setItem(META_KEY, '{not-json');
    sandbox.localStorage.setItem(SAVE_KEY, JSON.stringify({ games_played: 4, legacy_flag: 1 }));

    assert.doesNotThrow(() => backfillMeta());
    assert.equal(sandbox.localStorage.getItem(META_KEY), '{not-json');
    assert.equal(JSON.parse(sandbox.localStorage.getItem(SAVE_KEY)).legacy_flag, 1);

    let record;
    assert.doesNotThrow(() => {
      record = metaUpdate(SLUG, APP_VERSION, {
        stats: { games_played: 4, best_capture: Infinity, best_score: NaN },
        logros: ['ten_games', 'first_game', 'first_game']
      });
    });
    assert.equal(record.stats.games_played, 4);
    assert.equal('best_capture' in record.stats, false);
    assert.equal('best_score' in record.stats, false);
    assert.deepEqual(plain(record.logros), ['first_game', 'ten_games']);
    assert.equal(record.hitos.first_game, record.updatedAt);
    assert.equal(record.hitos.ten_games, record.updatedAt);
  });

  test('metaUpdate keeps earlier hitos and merges finite stats', () => {
    sandbox.localStorage.setItem(META_KEY, JSON.stringify({
      v: 1,
      slug: SLUG,
      version: '1.0.0',
      updatedAt: '2024-05-01T00:00:00.000Z',
      stats: { games_played: 1, best_score: 9 },
      logros: ['first_game'],
      hitos: { first_game: '2024-05-01T00:00:00.000Z', retired_id: '2024-04-01T00:00:00.000Z' }
    }));

    const record = metaUpdate(SLUG, APP_VERSION, {
      stats: { games_played: 2, best_score: NaN, turns_played: 7 },
      logros: ['first_game', 'ten_games']
    });

    assert.equal(record.version, APP_VERSION);
    assert.equal(record.stats.games_played, 2);
    assert.equal(record.stats.best_score, 9);
    assert.equal(record.stats.turns_played, 7);
    assert.equal(record.hitos.first_game, '2024-05-01T00:00:00.000Z');
    assert.match(record.hitos.ten_games, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal('retired_id' in record.hitos, false);
    assert.deepEqual(plain(record.logros), ['first_game', 'ten_games']);
  });

  test('posts the record to the parent frame and survives a rejected postMessage', () => {
    const messages = [];
    const frame = {
      parent: {
        postMessage(data, origin) {
          messages.push({ data, origin });
        }
      }
    };
    sandbox.window = frame;
    sandbox.location = { origin: 'https://juliangdeveloper.github.io' };

    const record = metaUpdate(SLUG, APP_VERSION, { stats: { games_played: 1 }, logros: ['first_game'] });

    assert.equal(messages.length, 1);
    assert.equal(messages[0].origin, 'https://juliangdeveloper.github.io');
    assert.deepEqual(plain(messages[0].data), { type: 'meta', key: META_KEY, data: plain(record) });

    frame.parent = frame;
    messages.length = 0;
    metaUpdate(SLUG, APP_VERSION, { stats: { games_played: 2 }, logros: ['first_game'] });
    assert.equal(messages.length, 0);

    frame.parent = {
      postMessage() {
        throw new Error('blocked');
      }
    };
    assert.doesNotThrow(() => metaUpdate(SLUG, APP_VERSION, { stats: { games_played: 3 }, logros: [] }));
    assert.equal(JSON.parse(sandbox.localStorage.getItem(META_KEY)).stats.games_played, 3);
  });

  test('a finished match updates the save without dropping unknown keys', () => {
    sandbox.localStorage.setItem(SAVE_KEY, JSON.stringify({ legacy_note: 'keep', games_played: 1 }));
    backfillMeta();

    recordMatch({
      players: [
        { type: 'human', totalCaptured: 30, big: 8 },
        { type: 'hard', totalCaptured: 20, big: 5 }
      ],
      turns: 12,
      wasted: 1,
      powerups: 2,
      bombs: 1,
      freezes: 1,
      steals: 0,
      doubles: 0,
      bestFlood: 8,
      colors: 6,
      cols: 18,
      rows: 14,
      wallCount: 3,
      unclaimed: 0
    });
    queueMetaUpdate();

    const saved = JSON.parse(sandbox.localStorage.getItem(SAVE_KEY));
    assert.equal(saved.legacy_note, 'keep');
    assert.equal(saved.games_played, 2);
    assert.deepEqual(loadSave().games_played, 2);
    const record = JSON.parse(sandbox.localStorage.getItem(META_KEY));
    assert.equal(record.stats.games_played, 2);
    assert.equal(record.stats.human_wins, 1);
    assert.equal(record.stats.hard_wins, 1);
    assert.equal(record.stats.best_score, 30);
    assert.equal(record.stats.cells_captured, 50);
    assert.equal(record.stats.big_board_games, 1);
    assert.equal(record.stats.full_clears, 1);
    assert.ok(record.logros.includes('first_win'));
    assert.ok(record.logros.includes('hard_win'));
    assert.ok(record.logros.includes('six_colors'));
    assert.ok(record.logros.includes('full_board'));
    assert.equal(record.logros.includes('big_wave'), false);
  });

  test('queueMetaUpdate writes at most once per second', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    sandbox.localStorage.setItem(SAVE_KEY, JSON.stringify({ games_played: 1 }));

    queueMetaUpdate();
    const first = sandbox.localStorage.getItem(META_KEY);
    sandbox.localStorage.setItem(SAVE_KEY, JSON.stringify({ games_played: 2 }));
    queueMetaUpdate();
    assert.equal(sandbox.localStorage.getItem(META_KEY), first);

    mock.timers.tick(999);
    assert.equal(sandbox.localStorage.getItem(META_KEY), first);
    mock.timers.tick(1);
    assert.equal(JSON.parse(sandbox.localStorage.getItem(META_KEY)).stats.games_played, 2);

    sandbox.localStorage.setItem(SAVE_KEY, JSON.stringify({ games_played: 3 }));
    queueMetaUpdate();
    assert.equal(JSON.parse(sandbox.localStorage.getItem(META_KEY)).stats.games_played, 2);
    mock.timers.tick(1000);
    assert.equal(JSON.parse(sandbox.localStorage.getItem(META_KEY)).stats.games_played, 3);
  });
});
