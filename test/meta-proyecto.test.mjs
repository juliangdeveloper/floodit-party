// meta.v1 proyecto block: written when valid, left out when invalid, optional on read.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, after, test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const sandbox = {
  console, Number, JSON, Object, Array, Set, Math, String, Error, Infinity, NaN, URLSearchParams,
  setTimeout: (...args) => globalThis.setTimeout(...args),
  clearTimeout: (...args) => globalThis.clearTimeout(...args)
};
Object.defineProperty(sandbox, 'Date', { get: () => globalThis.Date });
sandbox.globalThis = sandbox;
const context = createContext(sandbox);
for (const name of ['meta.js', 'progress.js']) {
  runInContext(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'), context, { filename: name });
}
const { metaKey, metaUpdate, metaReset, metaDeclare, metaProyecto, metaSetProyecto, PROYECTO, SLUG, STATS, backfillMeta } = sandbox;
const KEY = metaKey(SLUG);
const plain = (v) => JSON.parse(JSON.stringify(v));

function useStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  sandbox.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
  metaReset();
  metaDeclare(STATS);
  return map;
}

beforeEach(() => metaSetProyecto(null));
after(() => metaSetProyecto(null));

test('PROYECTO is a valid block within the shared ranges', () => {
  assert.deepEqual(plain(metaProyecto(PROYECTO)), plain(PROYECTO));
  assert.ok(Array.from(PROYECTO.objetivo).length <= 140);
});

test('backfill and updates write the proyecto block outside stats', () => {
  const map = useStorage();
  backfillMeta();
  const stored = JSON.parse(map.get(KEY));
  assert.equal(stored.v, 1);
  assert.deepEqual(stored.proyecto, plain(PROYECTO));
  assert.equal('proyecto' in stored.stats, false);
  const again = useStorage({ [KEY]: map.get(KEY) });
  metaUpdate(SLUG, '9.9.9', { stats: {}, logros: ['first_game'] });
  const next = JSON.parse(again.get(KEY));
  assert.deepEqual(next.proyecto, plain(PROYECTO));
  assert.ok(next.logros.includes('first_game'));
});

test('an invalid block is left out and never throws', () => {
  const P = PROYECTO;
  const bad = [
    'x', [], {},
    { ...P, objetivo: '' }, { ...P, objetivo: 'a'.repeat(141) }, { ...P, objetivo: 5 },
    { ...P, fase: 0 }, { ...P, fase: 7 }, { ...P, fase: 2.5 }, { ...P, fase: '4' },
    { ...P, fase_estado: -1 }, { ...P, fase_estado: 5 },
    { ...P, fases_completadas: 7 }, { ...P, fases_completadas: NaN },
    { get objetivo() { throw new Error('boom'); } }
  ];
  for (const p of bad) {
    assert.equal(metaProyecto(p), null);
    const map = useStorage();
    metaSetProyecto(p);
    assert.doesNotThrow(() => metaUpdate(SLUG, '9.9.9', { stats: {}, logros: ['first_game'] }));
    const stored = JSON.parse(map.get(KEY));
    assert.equal('proyecto' in stored, false);
    assert.deepEqual(stored.logros, ['first_game']);
  }
});

test('an old record without proyecto is still valid and gains the block', () => {
  const old = {
    v: 1, slug: SLUG, version: '1.0.3', updatedAt: '2026-01-01T00:00:00.000Z',
    stats: {}, logros: ['first_game'], hitos: { first_game: '2026-01-01T00:00:00.000Z' }
  };
  const raw = JSON.stringify(old);
  const map = useStorage({ [KEY]: raw });
  backfillMeta();
  assert.equal(map.get(KEY), raw);
  assert.equal(map.has(`${KEY}.corrupt`), false);
  metaUpdate(SLUG, '9.9.9', { stats: {}, logros: [] });
  const rec = JSON.parse(map.get(KEY));
  assert.equal(rec.hitos.first_game, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(rec.proyecto, plain(PROYECTO));
});

test('a stored record with a different proyecto gets the current block on the next write', () => {
  const old = {
    v: 1, slug: SLUG, version: '1.0.3', updatedAt: '2026-01-01T00:00:00.000Z',
    stats: {}, logros: ['first_game'], hitos: { first_game: '2026-01-01T00:00:00.000Z' },
    proyecto: { extra: 1, objetivo: 'Objetivo anterior.', fase: 2, fase_estado: 3, fases_completadas: 1 }
  };
  const map = useStorage({ [KEY]: JSON.stringify(old) });
  metaUpdate(SLUG, '9.9.9', { stats: {}, logros: [] });
  const rec = JSON.parse(map.get(KEY));
  assert.deepEqual(rec.proyecto, plain(PROYECTO));
  assert.equal(rec.hitos.first_game, '2026-01-01T00:00:00.000Z');
  assert.equal(map.has(`${KEY}.corrupt`), false);

  // With an invalid current block the stale one is dropped, not kept.
  metaSetProyecto({ fase: 9 });
  const second = useStorage({ [KEY]: JSON.stringify(old) });
  metaUpdate(SLUG, '9.9.9', { stats: {}, logros: [] });
  assert.equal('proyecto' in JSON.parse(second.get(KEY)), false);
});
