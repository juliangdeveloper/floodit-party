// Flood-It Party progress. Numbers only; player names stay out of the save.

const APP_VERSION = '1.0.1';
const SLUG = 'floodit-party';
const SAVE_KEY = 'floodit-party.save';

// Stable stat keys. Values are counts, totals, or bests from finished games.
const STAT_KEYS = [
  'games_played', // partidas terminadas
  'human_wins', // el primer puesto lo ocupó un humano
  'hard_wins', // victoria humana con una IA difícil en la mesa
  'best_capture', // mayor inundación en una jugada, en casillas
  'best_score', // más casillas capturadas por un jugador en una partida
  'cells_captured', // casillas capturadas entre todos los jugadores
  'turns_played', // turnos jugados
  'wasted_turns', // turnos que no capturaron casillas
  'powerups_taken', // power-ups recogidos
  'bombs_used', // bombas activadas
  'freezes_used', // congelaciones activadas
  'steals_used', // robos activados
  'doubles_used', // dobles activados
  'wall_games', // partidas con al menos un muro
  'four_player_games', // partidas de 4 jugadores
  'six_color_games', // partidas con 6 colores
  'big_board_games', // partidas en el tablero grande (18×14)
  'full_clears' // partidas terminadas sin casillas libres
];

// Stable achievement ids. `when` reads the stat snapshot above.
const ACHIEVEMENTS = [
  { id: 'first_game', when: (s) => s.games_played >= 1 }, // terminar 1 partida
  { id: 'ten_games', when: (s) => s.games_played >= 10 }, // terminar 10 partidas
  { id: 'fifty_games', when: (s) => s.games_played >= 50 }, // terminar 50 partidas
  { id: 'first_win', when: (s) => s.human_wins >= 1 }, // un humano queda primero
  { id: 'ten_wins', when: (s) => s.human_wins >= 10 }, // un humano queda primero 10 veces
  { id: 'big_wave', when: (s) => s.best_capture >= 20 }, // una inundación de 20 casillas
  { id: 'tidal_wave', when: (s) => s.best_capture >= 40 }, // una inundación de 40 casillas
  { id: 'power_10', when: (s) => s.powerups_taken >= 10 }, // recoger 10 power-ups
  { id: 'hard_win', when: (s) => s.hard_wins >= 1 }, // un humano gana ante una IA difícil
  { id: 'four_players', when: (s) => s.four_player_games >= 1 }, // terminar una partida de 4
  { id: 'six_colors', when: (s) => s.six_color_games >= 1 }, // terminar una partida de 6 colores
  { id: 'full_board', when: (s) => s.full_clears >= 1 } // terminar sin casillas libres
];

function store() {
  try {
    const local = globalThis.localStorage;
    if (local && typeof local.getItem === 'function') return local;
  } catch {
    // Ignore unavailable storage.
  }
  return null;
}

function readRawSave() {
  try {
    const local = store();
    if (!local) return {};
    const raw = local.getItem(SAVE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return data;
  } catch {
    return {};
  }
}

function emptyStats() {
  const stats = {};
  for (const key of STAT_KEYS) stats[key] = 0;
  return stats;
}

function statsFromSave(save) {
  const stats = emptyStats();
  if (!save || typeof save !== 'object') return stats;
  for (const key of STAT_KEYS) {
    const num = save[key];
    if (typeof num === 'number' && Number.isFinite(num)) stats[key] = num;
  }
  return stats;
}

function logrosFromSave(save) {
  const stats = statsFromSave(save);
  return ACHIEVEMENTS.filter((item) => item.when(stats)).map((item) => item.id).sort();
}

function loadSave() {
  return statsFromSave(readRawSave());
}

function writeSave(stats) {
  try {
    const local = store();
    if (!local) return;
    const next = { ...readRawSave() };
    for (const key of STAT_KEYS) {
      const num = stats[key];
      if (typeof num === 'number' && Number.isFinite(num)) next[key] = num;
    }
    local.setItem(SAVE_KEY, JSON.stringify(next));
  } catch {
    // A failed write must not stop the finished-game screen.
  }
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Same order as the results screen: cells captured, then largest single play.
function rankPlayers(players) {
  return [...players].sort((a, b) => (
    b.totalCaptured !== a.totalCaptured ? b.totalCaptured - a.totalCaptured : b.big - a.big
  ));
}

function recordMatch(match) {
  const save = loadSave();
  const players = Array.isArray(match.players) ? match.players : [];
  const ranked = rankPlayers(players);
  const winner = ranked[0];
  const humanWon = !!(winner && winner.type === 'human');
  const scores = players.map((player) => Math.max(0, count(player.totalCaptured)));
  const bestScore = scores.length ? Math.max(...scores) : 0;
  const captured = scores.reduce((sum, score) => sum + score, 0);
  const flood = Math.max(0, count(match.bestFlood));

  save.games_played += 1;
  save.turns_played += Math.max(0, count(match.turns));
  save.wasted_turns += Math.max(0, count(match.wasted));
  save.powerups_taken += Math.max(0, count(match.powerups));
  save.bombs_used += Math.max(0, count(match.bombs));
  save.freezes_used += Math.max(0, count(match.freezes));
  save.steals_used += Math.max(0, count(match.steals));
  save.doubles_used += Math.max(0, count(match.doubles));
  save.cells_captured += captured;
  if (bestScore > save.best_score) save.best_score = bestScore;
  if (flood > save.best_capture) save.best_capture = flood;
  if (humanWon) save.human_wins += 1;
  if (humanWon && players.some((player) => player.type === 'hard')) save.hard_wins += 1;
  if (players.length === 4) save.four_player_games += 1;
  if (count(match.colors) === 6) save.six_color_games += 1;
  if (count(match.cols) === 18 && count(match.rows) === 14) save.big_board_games += 1;
  if (count(match.wallCount) > 0) save.wall_games += 1;
  if (count(match.unclaimed) === 0) save.full_clears += 1;

  writeSave(save);
  return save;
}

function snapshotMeta() {
  const save = loadSave();
  return { stats: statsFromSave(save), logros: logrosFromSave(save) };
}

function backfillMeta() {
  return metaBackfill(SLUG, APP_VERSION, snapshotMeta);
}

let lastMetaAt = -Infinity;
let metaTimer = null;

// At most one write per second. A later call inside that window keeps the newest save.
function queueMetaUpdate() {
  const run = () => {
    metaTimer = null;
    lastMetaAt = Date.now();
    try {
      const snap = snapshotMeta();
      metaUpdate(SLUG, APP_VERSION, snap);
    } catch {
      // Progress publishing never blocks the match.
    }
  };
  const elapsed = Date.now() - lastMetaAt;
  if (!(elapsed >= 0 && elapsed < 1000)) {
    if (metaTimer) {
      clearTimeout(metaTimer);
      metaTimer = null;
    }
    run();
    return;
  }
  if (!metaTimer) metaTimer = setTimeout(run, 1000 - elapsed);
}

globalThis.APP_VERSION = APP_VERSION;
globalThis.SLUG = SLUG;
globalThis.SAVE_KEY = SAVE_KEY;
