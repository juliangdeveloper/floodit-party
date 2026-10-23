// Flood-It Party progress. Numbers only; player names stay out of the record.

const APP_VERSION = '1.0.4';
const SLUG = 'floodit-party';
const SAVE_KEY = 'floodit-party.save';

// Declared stat keys, in write order. Every one is a total, a count, or a best.
const STATS = [
  { key: 'games_played', monotonic: true }, // partidas terminadas
  { key: 'human_wins', monotonic: true }, // el primer puesto lo ocupó un humano
  { key: 'hard_wins', monotonic: true }, // victoria humana con una IA difícil en la mesa
  { key: 'best_capture', monotonic: true }, // mayor inundación en una jugada, en casillas
  { key: 'best_score', monotonic: true }, // más casillas capturadas por un jugador en una partida
  { key: 'cells_captured', monotonic: true }, // casillas capturadas entre todos los jugadores
  { key: 'turns_played', monotonic: true }, // turnos jugados
  { key: 'wasted_turns', monotonic: true }, // turnos que no capturaron casillas
  { key: 'powerups_taken', monotonic: true }, // power-ups recogidos
  { key: 'bombs_used', monotonic: true }, // bombas activadas
  { key: 'freezes_used', monotonic: true }, // congelaciones activadas
  { key: 'steals_used', monotonic: true }, // robos activados
  { key: 'doubles_used', monotonic: true }, // dobles activados
  { key: 'wall_games', monotonic: true }, // partidas con al menos un muro
  { key: 'four_player_games', monotonic: true }, // partidas de 4 jugadores
  { key: 'six_color_games', monotonic: true }, // partidas con 6 colores
  { key: 'big_board_games', monotonic: true }, // partidas en el tablero grande (18×14)
  { key: 'full_clears', monotonic: true } // partidas terminadas sin casillas libres
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

function emptyStats() {
  const stats = {};
  for (const entry of STATS) stats[entry.key] = 0;
  return stats;
}

function statsFromSave(save) {
  const stats = emptyStats();
  if (!save || typeof save !== 'object') return stats;
  for (const entry of STATS) {
    const num = save[entry.key];
    if (typeof num === 'number' && Number.isFinite(num)) stats[entry.key] = num;
  }
  return stats;
}

function logrosFromSave(save) {
  const stats = statsFromSave(save);
  return ACHIEVEMENTS.filter((item) => item.when(stats)).map((item) => item.id).sort();
}

// Read-only. Existing save keys are never rewritten.
function loadSave() {
  try {
    const local = store();
    if (!local) return emptyStats();
    const raw = local.getItem(SAVE_KEY);
    if (!raw) return emptyStats();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyStats();
    return statsFromSave(data);
  } catch {
    return emptyStats();
  }
}

function readMetaStats() {
  try {
    const local = store();
    if (!local) return null;
    const raw = local.getItem(metaKey(SLUG));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.v !== 1 || data.slug !== SLUG) return null;
    return statsFromSave(data.stats);
  } catch {
    return null;
  }
}

let latestStats = null;

function resetMatchTotals() {
  latestStats = null;
}

function baseStats() {
  if (latestStats) return statsFromSave(latestStats);
  return readMetaStats() || loadSave();
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
  const save = baseStats();
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

  latestStats = save;
  return save;
}

function snapshotMeta() {
  const stats = baseStats();
  return { stats, logros: logrosFromSave(stats) };
}

function backfillMeta() {
  return metaBackfill(SLUG, APP_VERSION, () => {
    const stats = loadSave();
    return { stats, logros: logrosFromSave(stats) };
  });
}

function queueMetaUpdate() {
  try {
    metaUpdate(SLUG, APP_VERSION, snapshotMeta());
  } catch {
    // Progress publishing never blocks the match.
  }
}

metaDeclare(STATS);
globalThis.APP_VERSION = APP_VERSION;
globalThis.SLUG = SLUG;
globalThis.SAVE_KEY = SAVE_KEY;
globalThis.STATS = STATS;
