'use strict';
/* =====================================================================
   Chinchón · Motor del marcador (sin pantalla)
   Lo usan la app y el servidor de partidas en línea.
   © 2026 IT Canarias
   ===================================================================== */
const DEF_CFG = {
  limit: 100,          // eliminado al pasar de este total
  closeBonus: -10,     // puntos al cerrar con todo ligado
  chinchon: 'win',     // 'win' = gana la partida | 'pts' = resta chinchonPts
  chinchonPts: -50,
  rebuyMode: 'max',    // 'max' = entra con los puntos del que más tiene | 'fixed' | 'none'
  rebuyFixed: 0,
  maxRebuys: 1,        // 0 = sin límite
  stake: 0,            // importe de entrada (€) – opcional
  rebuyStake: 0        // importe por reenganche (€)
};

const uid = () => Math.random().toString(36).slice(2, 10);

function compute(g) {
  const c = g.cfg, P = g.players, order = P.map(p => p.id);
  const st = {};
  P.forEach(p => st[p.id] = { total: 0, out: false, rebuys: 0, outHand: null });
  let lastDealer = null, hand = 0, ended = null;
  const rows = [];
  g.events.forEach((e, idx) => {
    if (ended && ended.by === 'chinchon') return;
    if (e.t === 'hand') {
      hand++;
      const applied = {};
      for (const id in e.scores) {
        if (st[id] && !st[id].out) { st[id].total += e.scores[id]; applied[id] = e.scores[id]; }
      }
      lastDealer = e.dealer;
      const newlyOut = [];
      P.forEach(p => { const s = st[p.id]; if (!s.out && s.total > c.limit) { s.out = true; s.outHand = hand; newlyOut.push(p.id); } });
      if (e.kind === 'chinchon' && c.chinchon === 'win' && e.closer) ended = { by: 'chinchon', winner: e.closer };
      rows.push({ type: 'hand', idx, n: hand, e, applied, totals: Object.fromEntries(P.map(p => [p.id, { t: st[p.id].total, out: st[p.id].out }])), newlyOut });
    } else if (e.t === 'rebuy') {
      const s = st[e.p];
      const valid = s && s.out;
      if (valid) { s.out = false; s.total = e.score; s.rebuys++; s.outHand = null; }
      rows.push({ type: 'rebuy', idx, n: hand, e, valid });
    }
  });
  const active = P.filter(p => !st[p.id].out);
  if (!ended && hand > 0 && active.length <= 1) {
    const w = active[0] ? active[0].id : P.slice().sort((a, b) => st[a.id].total - st[b.id].total)[0].id;
    ended = { by: 'last', winner: w };
  }
  // Siguiente en dar: el siguiente jugador activo en el orden de la mesa
  let next = null;
  if (lastDealer == null) next = st[g.firstDealer] && !st[g.firstDealer].out ? g.firstDealer : (active[0] && active[0].id);
  else {
    const i = order.indexOf(lastDealer);
    for (let k = 1; k <= order.length; k++) { const id = order[(i + k) % order.length]; if (!st[id].out) { next = id; break; } }
  }
  // Quién sale (el de la derecha/siguiente del que da)
  let lead = null;
  if (next) { const i = order.indexOf(next); for (let k = 1; k < order.length; k++) { const id = order[(i + k) % order.length]; if (!st[id].out) { lead = id; break; } } }
  const totalRebuys = P.reduce((a, p) => a + st[p.id].rebuys, 0);
  const pot = (c.stake || 0) * P.length + (c.rebuyStake || 0) * totalRebuys;
  return { st, active, hand, ended, next, lead, rows, pot, totalRebuys };
}

function rebuyScore(g, R) {
  if (g.cfg.rebuyMode === 'fixed') return Number(g.cfg.rebuyFixed) || 0;
  return R.active.length ? Math.max(...R.active.map(p => R.st[p.id].total)) : 0;
}

function canRebuy(g, R, pid) {
  const s = R.st[pid], c = g.cfg;
  if (!s.out || c.rebuyMode === 'none') return false;
  if (R.ended && R.ended.by === 'chinchon') return false;
  if (!R.active.length) return false;
  if (c.maxRebuys > 0 && s.rebuys >= c.maxRebuys) return false;
  return true;
}

const pname = (g, id) => (g.players.find(p => p.id === id) || {}).name || '?';
