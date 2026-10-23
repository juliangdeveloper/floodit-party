import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
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
const { metaKey, metaUpdate, metaReset, metaDeclare, metaProyecto, PROYECTO, SLUG, STATS, FASE, ESTADO_FASE, TIPO_STAT } = sandbox;

test('los enums están congelados y PROYECTO usa sus valores', () => {
  for (const e of [FASE, ESTADO_FASE, TIPO_STAT, STATS]) assert.ok(Object.isFrozen(e));
  assert.deepEqual([...Object.values(FASE)], [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([...Object.values(ESTADO_FASE)], [0, 1, 2, 3, 4]);
  assert.equal(PROYECTO.fase, FASE.DESCARTADA);
  assert.equal(PROYECTO.fase_estado, ESTADO_FASE.COMPLETADA);
  assert.deepEqual(JSON.parse(JSON.stringify(metaProyecto(PROYECTO))), JSON.parse(JSON.stringify(PROYECTO)));
});

test('cada stat declara un tipo válido y una unidad, y la mezcla respeta su tipo', () => {
  const tipos = Object.values(TIPO_STAT);
  const keys = Object.keys(STATS);
  assert.ok(keys.length >= 1 && keys.length <= 20);
  for (const key of keys) {
    assert.ok(tipos.includes(STATS[key].tipo), key);
    assert.ok(typeof STATS[key].unidad === 'string' && STATS[key].unidad.length > 0, key);
  }
  const map = new Map();
  sandbox.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
  const declared = Object.assign({}, STATS, { en_curso: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: 'prueba' } });
  metaReset();
  metaDeclare(declared);
  const alto = {};
  const bajo = {};
  for (const key of Object.keys(declared)) { alto[key] = 10; bajo[key] = 3; }
  metaUpdate(SLUG, '1', { stats: alto, logros: [] });
  metaReset();
  metaUpdate(SLUG, '1', { stats: bajo, logros: [] });
  const record = JSON.parse(map.get(metaKey(SLUG)));
  for (const key of Object.keys(declared)) {
    assert.equal(record.stats[key], declared[key].tipo === TIPO_STAT.VALOR_ACTUAL ? 3 : 10, key);
  }
  metaDeclare(STATS);
});
