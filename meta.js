
var FASE = Object.freeze({ IDEA: 1, DEFINICION: 2, DISENO: 3, CONSTRUCCION: 4, VALIDACION: 5, LANZAMIENTO_Y_MANTENIMIENTO: 6, DESCARTADA: 7 });
var ESTADO_FASE = Object.freeze({ PENDIENTE: 0, EN_CURSO: 1, BLOQUEADA: 2, EN_REVISION: 3, COMPLETADA: 4 });
var TIPO_STAT = Object.freeze({ TOTAL_ACUMULADO: 'total_acumulado', MEJOR_MARCA: 'mejor_marca', VALOR_ACTUAL: 'valor_actual' });
var TIPO_PROYECTO = Object.freeze({ PROYECTO: 'proyecto', AREA: 'area', RECURSO: 'recurso', ARCHIVO: 'archivo' });

var PROYECTO = {
  objetivo: 'En algún momento pensé que era una buena idea, pero tal vez te sirva de inspiración.',
  fase: FASE.DESCARTADA,
  fase_estado: ESTADO_FASE.COMPLETADA,
  fases_completadas: 2,
  tipo: TIPO_PROYECTO.PROYECTO,
  aportes: [
    { stat: 'Programación', exp: 5, fuente: 'creacion' },
    { stat: 'Diseño', exp: 9, fuente: 'creacion' },
    { stat: 'Planificación', exp: 20, fuente: 'uso' }
  ]
};

var proyectoSource = PROYECTO;

function proyectoInt(n, lo, hi) {
  return typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
}

function enumValido(enumeracion, valor) {
  return Object.values(enumeracion).indexOf(valor) !== -1;
}

function statConservaMaximo(tipo) {
  return tipo === TIPO_STAT.TOTAL_ACUMULADO || tipo === TIPO_STAT.MEJOR_MARCA;
}

function statsDeclarados(stats) {
  if (Array.isArray(stats)) return stats;
  if (!stats || typeof stats !== 'object') return [];
  return Object.keys(stats).map(function (key) { return { key: key, tipo: stats[key] && stats[key].tipo }; });
}

var APORTE_STAT_MAX = 32;
var APORTE_EXP_MAX = 99;

function aportesValidos(lista) {
  if (!Array.isArray(lista)) return null;
  var out = [];
  var seen = {};
  for (var i = 0; i < lista.length; i++) {
    var it = lista[i];
    if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
    var stat = it.stat;
    var exp = it.exp;
    var fuente = it.fuente;
    if (typeof stat !== 'string' || !stat.trim() || stat !== stat.trim() || Array.from(stat).length > APORTE_STAT_MAX) return null;
    if (fuente !== 'creacion' && fuente !== 'uso') return null;
    if (!(proyectoInt(exp, 1, APORTE_EXP_MAX))) return null;
    var key = stat + '\n' + fuente;
    if (seen[key]) return null;
    if (Object.keys(it).length !== 3) return null;
    seen[key] = true;
    out.push({ stat: stat, exp: exp, fuente: fuente });
  }
  return out;
}

function metaProyecto(p) {
  try {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    var o = p.objetivo;
    if (typeof o !== 'string' || !o.trim() || Array.from(o).length > 140) return null;
    if (!enumValido(FASE, p.fase) || !enumValido(ESTADO_FASE, p.fase_estado) || !proyectoInt(p.fases_completadas, 0, FASE.LANZAMIENTO_Y_MANTENIMIENTO)) return null;
    if (p.tipo !== undefined && !enumValido(TIPO_PROYECTO, p.tipo)) return null;
    var bloque = { objetivo: o, fase: p.fase, fase_estado: p.fase_estado, fases_completadas: p.fases_completadas };
    if (p.tipo !== undefined) bloque.tipo = p.tipo;
    if (p.bloqueada === true) bloque.bloqueada = true;
    if (p.aportes !== undefined) {
      var aportes = aportesValidos(p.aportes);
      if (!aportes) return null;
      bloque.aportes = aportes;
    }
    return bloque;
  } catch (e) {
    return null;
  }
}

function metaSetProyecto(p) {
  proyectoSource = p === null ? PROYECTO : p;
}

function metaDeclararProyecto(slug, version) {
  try {
    var store = globalThis.localStorage;
    if (!store || !slug) return null;
    var clave = 'meta.v1.' + slug;
    var raw = store.getItem(clave);
    var base = null;
    if (raw != null && raw !== '') {
      try {
        var previo = JSON.parse(raw);
        if (previo && typeof previo === 'object' && !Array.isArray(previo) && previo.v === 1 && previo.slug === slug) base = previo;
      } catch (e) {
        base = null;
      }
      if (!base) store.setItem(clave + '.corrupt', String(raw));
    }
    if (!base) base = { v: 1, slug: slug, version: String(version == null ? '' : version).replace(/^[vV]/, ''), updatedAt: new Date().toISOString(), stats: {}, logros: [], hitos: {} };
    var p = metaProyecto(proyectoSource);
    if (p) base.proyecto = p;
    var texto = JSON.stringify(base);
    if (texto !== raw) {
      store.setItem(clave, texto);
      if (typeof window !== 'undefined' && window.parent && window.parent !== window) window.parent.postMessage({ type: 'meta', key: clave, data: base }, location.origin);
    }
    return base;
  } catch (e) {
    return null;
  }
}

function withProyecto(record) {
  var p = metaProyecto(proyectoSource);
  if (p) record.proyecto = p;
  return record;
}

function metaKey(slug) {
  return `meta.v1.${slug}`;
}

let declaredStats = [];
let lastWriteAt = -Infinity;
let pendingWrite = null;
let writeTimer = null;
let flushBound = false;

function storage() {
  try {
    const store = globalThis.localStorage;
    if (store && typeof store.getItem === 'function' && typeof store.setItem === 'function') return store;
  } catch {
  }
  return null;
}

function metaDeclare(list) {
  declaredStats = statsDeclarados(list).slice(0, 20);
}

function plainVersion(version) {
  const text = String(version == null ? '' : version).trim();
  if (text.charAt(0) === 'v' || text.charAt(0) === 'V') return text.slice(1);
  return text;
}

function declaredEntries() {
  const entries = [];
  for (const item of declaredStats) {
    if (entries.length >= 20) break;
    const key = typeof item === 'string' ? item : item && item.key;
    if (typeof key !== 'string' || !key) continue;
    if (entries.some((entry) => entry.key === key)) continue;
    entries.push({
      key,
      tipo: item && typeof item === 'object' ? item.tipo : undefined
    });
  }
  return entries;
}

function mergeStats(prevStats, incoming) {
  const prev = prevStats && typeof prevStats === 'object' && !Array.isArray(prevStats) ? prevStats : {};
  const next = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {};
  const stats = {};
  for (const entry of declaredEntries()) {
    const oldNum = typeof prev[entry.key] === 'number' && Number.isFinite(prev[entry.key]) ? prev[entry.key] : undefined;
    const hasNew = Object.prototype.hasOwnProperty.call(next, entry.key)
      && typeof next[entry.key] === 'number'
      && Number.isFinite(next[entry.key]);
    if (hasNew && statConservaMaximo(entry.tipo) && oldNum !== undefined) stats[entry.key] = Math.max(oldNum, next[entry.key]);
    else if (hasNew) stats[entry.key] = next[entry.key];
    else if (oldNum !== undefined) stats[entry.key] = oldNum;
  }
  return stats;
}

function logroIds(value) {
  const ids = [];
  if (!Array.isArray(value)) return ids;
  for (const id of value) {
    if (typeof id === 'string' && id) ids.push(id);
  }
  return ids;
}

function classify(raw, slug) {
  if (raw == null) return { state: 'missing' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: 'corrupt', raw };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.v !== 1 || parsed.slug !== slug) {
    return { state: 'corrupt', raw };
  }
  return { state: 'valid', record: parsed };
}

function salvage(store, slug, raw) {
  try {
    store.setItem(`${metaKey(slug)}.corrupt`, String(raw));
  } catch {
  }
}

function buildRecord(slug, version, prev, payload) {
  const incoming = payload && typeof payload === 'object' ? payload : {};
  const base = prev && typeof prev === 'object' ? prev : {};
  const ids = new Set([...logroIds(base.logros), ...logroIds(incoming.logros)]);
  const logros = [...ids].sort();
  const prevHitos = base.hitos && typeof base.hitos === 'object' && !Array.isArray(base.hitos) ? base.hitos : {};
  const now = new Date().toISOString();
  const hitos = {};
  for (const id of logros) {
    const stamp = prevHitos[id];
    hitos[id] = typeof stamp === 'string' && stamp ? stamp : now;
  }
  return {
    v: 1,
    slug,
    version: plainVersion(version),
    updatedAt: now,
    stats: mergeStats(base.stats, incoming.stats),
    logros,
    hitos
  };
}

function postRecord(key, record) {
  try {
    const frame = globalThis.window;
    if (frame && frame.parent && frame.parent !== frame) {
      frame.parent.postMessage({ type: 'meta', key, data: record }, globalThis.location.origin);
    }
  } catch {
  }
}

function commitWrite(job) {
  const store = storage();
  if (!store) return null;
  try {
    const record = withProyecto(buildRecord(job.slug, job.version, job.prev, job.payload));
    store.setItem(job.key, JSON.stringify(record));
    lastWriteAt = Date.now();
    postRecord(job.key, record);
    return record;
  } catch {
    return null;
  }
}

function writeDue() {
  const elapsed = Date.now() - lastWriteAt;
  return !(elapsed >= 0 && elapsed < 1000);
}

function clearWriteTimer() {
  if (!writeTimer) return;
  try {
    clearTimeout(writeTimer);
  } catch {
  }
  writeTimer = null;
}

function armWrite(delay) {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (!pendingWrite) {
      pendingWrite = null;
      return;
    }
    if (!writeDue()) {
      armWrite(Math.max(0, 1000 - (Date.now() - lastWriteAt)));
      return;
    }
    const job = pendingWrite;
    pendingWrite = null;
    commitWrite(job);
  }, delay);
}

function enqueue(slug, version, payload, prev) {
  const job = { slug, version, payload, prev, key: metaKey(slug) };
  if (writeDue()) {
    clearWriteTimer();
    pendingWrite = null;
    return commitWrite(job);
  }
  pendingWrite = job;
  armWrite(Math.max(0, 1000 - (Date.now() - lastWriteAt)));
  return null;
}

function metaUpdate(slug, version, payload) {
  try {
    bindFlush();
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(metaKey(slug));
    const found = classify(raw, slug);
    if (found.state === 'corrupt') salvage(store, slug, raw);
    const prev = found.state === 'valid' ? found.record : {};
    return enqueue(slug, version, payload, prev);
  } catch {
    return null;
  }
}

function metaBackfill(slug, version, build) {
  try {
    bindFlush();
    const store = storage();
    if (!store) return null;
    const key = metaKey(slug);
    const raw = store.getItem(key);
    const found = classify(raw, slug);
    if (found.state === 'valid') return null;
    if (found.state === 'corrupt') salvage(store, slug, raw);
    const built = typeof build === 'function' ? build() : (build || {});
    const source = built && typeof built === 'object' ? built : {};
    return enqueue(slug, version, {
      stats: source.stats || {},
      logros: source.logros || []
    }, {});
  } catch {
    return null;
  }
}

function metaFlush() {
  try {
    if (!pendingWrite) return null;
    clearWriteTimer();
    const job = pendingWrite;
    pendingWrite = null;
    return commitWrite(job);
  } catch {
    return null;
  }
}

function metaReset() {
  lastWriteAt = -Infinity;
  pendingWrite = null;
  flushBound = false;
  clearWriteTimer();
}

function onVisibilityChange() {
  try {
    const doc = globalThis.document;
    if (doc && doc.visibilityState === 'hidden') metaFlush();
  } catch {
  }
}

function bindFlush() {
  if (flushBound) return;
  try {
    const listen = globalThis.addEventListener;
    if (typeof listen !== 'function') return;
    listen.call(globalThis, 'pagehide', metaFlush);
    listen.call(globalThis, 'visibilitychange', onVisibilityChange);
    listen.call(globalThis, 'unload', metaFlush);
    flushBound = true;
  } catch {
  }
}

bindFlush();
