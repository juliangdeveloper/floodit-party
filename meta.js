// Shared meta.v1 progress record. Same behavior in every app.

function metaKey(slug) {
  return `meta.v1.${slug}`;
}

function storage() {
  try {
    const store = globalThis.localStorage;
    if (store && typeof store.getItem === 'function' && typeof store.setItem === 'function') return store;
  } catch {
    // Storage can throw just for being touched (blocked or disabled).
  }
  return null;
}

function finiteStats(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, num] of Object.entries(value)) {
    if (typeof num === 'number' && Number.isFinite(num)) out[key] = num;
  }
  return out;
}

function logroIds(value) {
  const ids = [];
  if (!Array.isArray(value)) return ids;
  for (const id of value) {
    if (typeof id === 'string' && id) ids.push(id);
  }
  return ids;
}

function metaUpdate(slug, version, payload) {
  try {
    const store = storage();
    if (!store) return null;
    const key = metaKey(slug);
    let prev = {};
    try {
      const raw = store.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') prev = parsed;
      }
    } catch {
      prev = {};
    }

    const stats = finiteStats(prev.stats);
    const incoming = payload && typeof payload === 'object' ? payload : {};
    Object.assign(stats, finiteStats(incoming.stats));

    const ids = new Set([...logroIds(prev.logros), ...logroIds(incoming.logros)]);
    const logros = [...ids].sort();

    const prevHitos = prev.hitos && typeof prev.hitos === 'object' ? prev.hitos : {};
    const now = new Date().toISOString();
    const hitos = {};
    for (const id of logros) {
      const stamp = prevHitos[id];
      hitos[id] = typeof stamp === 'string' && stamp ? stamp : now;
    }

    const record = {
      v: 1,
      slug,
      version: String(version),
      updatedAt: now,
      stats,
      logros,
      hitos
    };
    store.setItem(key, JSON.stringify(record));

    try {
      const frame = globalThis.window;
      if (frame && frame.parent && frame.parent !== frame) {
        frame.parent.postMessage({ type: 'meta', key, data: record }, globalThis.location.origin);
      }
    } catch {
      // A parent that rejects the message must not affect the saved record.
    }
    return record;
  } catch {
    return null;
  }
}

// Build the record once when the key is absent. An existing value is left as stored.
function metaBackfill(slug, version, build) {
  try {
    const store = storage();
    if (!store) return null;
    const key = metaKey(slug);
    if (store.getItem(key) !== null) return null;
    const built = typeof build === 'function' ? build() : (build || {});
    const source = built && typeof built === 'object' ? built : {};
    return metaUpdate(slug, version, {
      stats: source.stats || {},
      logros: source.logros || []
    });
  } catch {
    return null;
  }
}
