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
  URLSearchParams,
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
  metaFlush,
  metaReset,
  metaDeclare,
  APP_VERSION,
  SAVE_KEY,
  SLUG,
  STATS,
  backfillMeta,
  queueMetaUpdate,
  recordMatch,
  resetMatchTotals
} = sandbox;

const META_KEY = metaKey(SLUG);
const CORRUPT_KEY = `${META_KEY}.corrupt`;

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

function metaWrites(map) {
  return map.filter((key) => key === META_KEY).length;
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

const MATCH = {
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
};

describe('meta.v1 migration', { concurrency: false }, () => {
  beforeEach(() => {
    installStorage();
    metaReset();
    metaDeclare(STATS);
    resetMatchTotals();
    delete sandbox.window;
    delete sandbox.location;
  });

  afterEach(() => {
    mock.timers.reset();
    delete sandbox.window;
    delete sandbox.location;
  });

  test('an old save without the meta key produces a record from that save', () => {
    const rawSave = JSON.stringify(OLD_SAVE);
    sandbox.localStorage.setItem(SAVE_KEY, rawSave);

    const record = backfillMeta();

    assert.ok(record);
    assert.equal(record.v, 1);
    assert.equal(record.slug, SLUG);
    assert.equal(record.version, APP_VERSION);
    assert.equal(record.version.startsWith('v'), false);
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
    assert.deepEqual(Object.keys(record.stats), plain(STATS).map((entry) => entry.key));
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
    for (const id of record.logros) assert.equal(record.hitos[id], record.updatedAt);
    assert.equal(sandbox.localStorage.getItem(SAVE_KEY), rawSave);
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
    const rawSave = JSON.stringify(OLD_SAVE);
    sandbox.localStorage.setItem(META_KEY, raw);
    sandbox.localStorage.setItem(SAVE_KEY, rawSave);

    const result = backfillMeta();

    assert.equal(result, null);
    assert.equal(sandbox.localStorage.getItem(META_KEY), raw);
    assert.equal(sandbox.localStorage.getItem(SAVE_KEY), rawSave);
  });

  test('a corrupt record is copied aside and rebuilt from the save', () => {
    const rawSave = JSON.stringify({ games_played: 4, legacy_flag: 1, blob: 'x'.repeat(64) });
    sandbox.localStorage.setItem(SAVE_KEY, rawSave);
    const cases = [
      '{not-json',
      JSON.stringify({ v: 2, slug: SLUG, stats: { games_played: 99 } }),
      JSON.stringify({ v: 1, slug: 'other-app', stats: { games_played: 99 } }),
      JSON.stringify([1, 2, 3])
    ];
    for (const raw of cases) {
      installStorage();
      metaReset();
      sandbox.localStorage.setItem(SAVE_KEY, rawSave);
      sandbox.localStorage.setItem(META_KEY, raw);
      let record;
      assert.doesNotThrow(() => {
        record = backfillMeta();
      });
      assert.equal(sandbox.localStorage.getItem(CORRUPT_KEY), raw);
      assert.equal(sandbox.localStorage.getItem(SAVE_KEY), rawSave);
      assert.equal(record.v, 1);
      assert.equal(record.slug, SLUG);
      assert.equal(record.stats.games_played, 4);
      assert.deepEqual(plain(record.logros), ['first_game']);
      assert.equal(record.hitos.first_game, record.updatedAt);
      assert.equal(record.stats.games_played === 99, false);
    }
  });

  test('metaUpdate keeps earlier hitos and strips a leading v from the version', () => {
    sandbox.localStorage.setItem(META_KEY, JSON.stringify({
      v: 1,
      slug: SLUG,
      version: '1.0.0',
      updatedAt: '2024-05-01T00:00:00.000Z',
      stats: { games_played: 1, best_score: 9, extra_stat: 4 },
      logros: ['first_game'],
      hitos: { first_game: '2024-05-01T00:00:00.000Z', retired_id: '2024-04-01T00:00:00.000Z' }
    }));

    const record = metaUpdate(SLUG, `v${APP_VERSION}`, {
      stats: { games_played: 2, best_score: NaN, turns_played: 7, extra_stat: 8 },
      logros: ['first_game', 'ten_games']
    });

    assert.equal(record.version, APP_VERSION);
    assert.equal(record.stats.games_played, 2);
    assert.equal(record.stats.best_score, 9);
    assert.equal(record.stats.turns_played, 7);
    assert.equal('extra_stat' in record.stats, false);
    assert.equal(record.hitos.first_game, '2024-05-01T00:00:00.000Z');
    assert.match(record.hitos.ten_games, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal('retired_id' in record.hitos, false);
    assert.deepEqual(plain(record.logros), ['first_game', 'ten_games']);
  });

  test('the helper writes at most 20 declared stats, in declared order', () => {
    const declared = [];
    for (let i = 0; i < 21; i += 1) declared.push({ key: `stat_${i}`, monotonic: false });
    metaDeclare(declared);
    const stats = { undeclared: 99 };
    declared.forEach((entry, index) => {
      stats[entry.key] = index + 1;
    });

    const record = metaUpdate(SLUG, APP_VERSION, { stats, logros: [] });

    assert.deepEqual(Object.keys(record.stats), declared.slice(0, 20).map((entry) => entry.key));
    assert.equal(record.stats.stat_0, 1);
    assert.equal(record.stats.stat_19, 20);
    assert.equal('stat_20' in record.stats, false);
    assert.equal('undeclared' in record.stats, false);
  });

  test('monotonic stats keep the higher value and other stats replace', () => {
    metaDeclare([
      { key: 'games_played', monotonic: true },
      { key: 'mood', monotonic: false }
    ]);
    metaUpdate(SLUG, APP_VERSION, { stats: { games_played: 5, mood: 3 }, logros: [] });
    metaReset();

    const record = metaUpdate(SLUG, APP_VERSION, {
      stats: { games_played: 2, mood: 1, mood_note: NaN },
      logros: []
    });

    assert.equal(record.stats.games_played, 5);
    assert.equal(record.stats.mood, 1);
    assert.deepEqual(Object.keys(record.stats), ['games_played', 'mood']);

    metaReset();
    const kept = metaUpdate(SLUG, APP_VERSION, { stats: { mood: Infinity }, logros: [] });
    assert.equal(kept.stats.games_played, 5);
    assert.equal(kept.stats.mood, 1);
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
    sandbox.location = { origin: 'https://juliangdeveloper.github.io', search: '' };

    const record = metaUpdate(SLUG, APP_VERSION, { stats: { games_played: 1 }, logros: ['first_game'] });

    assert.equal(messages.length, 1);
    assert.equal(messages[0].origin, 'https://juliangdeveloper.github.io');
    assert.deepEqual(plain(messages[0].data), { type: 'meta', key: META_KEY, data: plain(record) });

    metaReset();
    frame.parent = frame;
    messages.length = 0;
    metaUpdate(SLUG, APP_VERSION, { stats: { games_played: 2 }, logros: ['first_game'] });
    assert.equal(messages.length, 0);
    assert.equal(JSON.parse(sandbox.localStorage.getItem(META_KEY)).stats.games_played, 2);

    metaReset();
    frame.parent = {
      postMessage() {
        throw new Error('blocked');
      }
    };
    assert.doesNotThrow(() => metaUpdate(SLUG, APP_VERSION, { stats: { games_played: 3 }, logros: ['first_game'] }));
    assert.equal(JSON.parse(sandbox.localStorage.getItem(META_KEY)).stats.games_played, 3);
  });

  test('demo and preview modes do not write or postMessage', () => {
    const messages = [];
    sandbox.window = {
      parent: {
        postMessage() {
          messages.push('meta');
        }
      }
    };
    for (const search of ['?demo=1', '?preview=1']) {
      installStorage();
      metaReset();
      messages.length = 0;
      sandbox.location = { origin: 'https://juliangdeveloper.github.io', search };
      sandbox.localStorage.setItem(SAVE_KEY, JSON.stringify({ games_played: 3 }));
      assert.equal(backfillMeta(), null);
      assert.equal(metaUpdate(SLUG, APP_VERSION, { stats: { games_played: 3 }, logros: ['first_game'] }), null);
      metaFlush();
      assert.equal(sandbox.localStorage.getItem(META_KEY), null);
      assert.equal(messages.length, 0);
      assert.equal(sandbox.localStorage.getItem(SAVE_KEY), JSON.stringify({ games_played: 3 }));
    }
  });

  test('old save keys stay byte-identical after load and play', () => {
    const rawSave = JSON.stringify({ legacy_note: 'keep', games_played: 1, blob: 'y'.repeat(4000) });
    const other = '{"score":1,"photo":"abc"}';
    sandbox.localStorage.setItem(SAVE_KEY, rawSave);
    sandbox.localStorage.setItem('other.game.save', other);

    backfillMeta();
    recordMatch(MATCH);
    queueMetaUpdate();
    metaFlush();

    assert.equal(sandbox.localStorage.getItem(SAVE_KEY), rawSave);
    assert.equal(sandbox.localStorage.getItem('other.game.save'), other);
    const record = JSON.parse(sandbox.localStorage.getItem(META_KEY));
    assert.equal(record.stats.games_played, 2);
    assert.equal(record.stats.human_wins, 1);
    assert.equal(record.stats.hard_wins, 1);
    assert.equal(record.stats.best_score, 30);
    assert.equal(record.stats.cells_captured, 50);
    assert.equal(record.stats.big_board_games, 1);
    assert.equal(record.stats.full_clears, 1);
    assert.equal(record.logros.includes('first_win'), true);
    assert.equal(record.logros.includes('hard_win'), true);
    assert.equal(record.logros.includes('six_colors'), true);
    assert.equal(record.logros.includes('full_board'), true);
    assert.equal(record.logros.includes('big_wave'), false);
  });

  test('at most one meta write per second, including backfill and flush', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const written = [];
    const messages = [];
    const orig = sandbox.localStorage.setItem;
    sandbox.localStorage.setItem = (key, value) => {
      written.push(key);
      orig.call(sandbox.localStorage, key, value);
    };
    sandbox.window = {
      parent: {
        postMessage() {
          messages.push('meta');
        }
      }
    };
    sandbox.location = { origin: 'https://juliangdeveloper.github.io', search: '' };
    sandbox.localStorage.setItem(SAVE_KEY, JSON.stringify({ games_played: 1 }));

    backfillMeta();
    metaUpdate(SLUG, APP_VERSION, { stats: { games_played: 4 }, logros: ['first_game'] });
    assert.equal(metaWrites(written), 1);
    assert.equal(messages.length, 1);
    assert.equal(JSON.parse(sandbox.localStorage.getItem(META_KEY)).stats.games_played, 1);

    metaFlush();
    assert.equal(metaWrites(written), 2);
    assert.equal(messages.length, 2);
    assert.equal(JSON.parse(sandbox.localStorage.getItem(META_KEY)).stats.games_played, 4);

    metaFlush();
    assert.equal(metaWrites(written), 2);
    assert.equal(messages.length, 2);

    metaUpdate(SLUG, APP_VERSION, { stats: { games_played: 6 }, logros: ['first_game'] });
    assert.equal(metaWrites(written), 2);
    mock.timers.tick(999);
    assert.equal(metaWrites(written), 2);
    mock.timers.tick(1);
    assert.equal(metaWrites(written), 3);
    assert.equal(messages.length, 3);
    assert.equal(JSON.parse(sandbox.localStorage.getItem(META_KEY)).stats.games_played, 6);
  });

  test('pagehide flushes a pending change and unload does not write again', () => {
    const handlers = {};
    sandbox.addEventListener = (type, fn) => {
      handlers[type] = fn;
    };
    sandbox.localStorage.setItem(SAVE_KEY, JSON.stringify({ games_played: 1 }));
    backfillMeta();
    assert.equal(typeof handlers.pagehide, 'function');
    assert.equal(typeof handlers.unload, 'function');

    metaUpdate(SLUG, APP_VERSION, { stats: { games_played: 3 }, logros: ['first_game'] });
    assert.equal(JSON.parse(sandbox.localStorage.getItem(META_KEY)).stats.games_played, 1);
    handlers.pagehide();
    assert.equal(JSON.parse(sandbox.localStorage.getItem(META_KEY)).stats.games_played, 3);
    const afterHide = sandbox.localStorage.getItem(META_KEY);
    handlers.unload();
    assert.equal(sandbox.localStorage.getItem(META_KEY), afterHide);
  });
});
