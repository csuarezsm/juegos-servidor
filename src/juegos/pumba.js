'use strict';
/*
 * Pumba en línea. El estado es la misma "partida" de la app (g), con g.play.hand.
 * Cada asiento de la sala es un jugador (id p1…p6). La máquina juega en las sillas de bot
 * y, con el nivel normal, por quien se queda sin conexión.
 * «¡Pumba!» olvidado: cualquier silla puede reclamarlo hasta que el siguiente eche carta o robe.
 */
const { pumba: E } = require('../motor');

const id = 'pumba';
const min = 2, max = 6;
const PAUSA_RECLAMAR_MS = +process.env.PAUSA_RECLAMAR_MS || 2500;   // tiempo extra para reclamar antes de que juegue la máquina

function opciones(o) {
  o = o || {};
  const n = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, Math.round(+v))) : d);
  return {
    limite: n(o.limite, 50, 500, 100),
    reenganches: n(o.reenganches, 0, 3, 1),
    figuras: o.figuras === 'diez' ? 'diez' : 'cara',
    sotaLibre: o.sotaLibre !== false,
    cierreCastigo: o.cierreCastigo !== false,
    nivel: ['facil', 'normal', 'dificil'].includes(o.nivel) ? o.nivel : 'normal'
  };
}

function iniciar(sala) {
  const op = sala.opciones;
  const players = sala.asientos.map(a => ({ id: a.id, name: a.nombre }));
  const bots = sala.asientos.filter(a => a.bot).map(a => a.id);
  const g = {
    id: sala.codigo + '-' + Date.now().toString(36), created: Date.now(),
    cfg: Object.assign({}, E.DEF_CFG, { limit: op.limite, maxRebuys: op.reenganches }),
    players, firstDealer: players[Math.floor(Math.random() * players.length)].id, events: [],
    play: E.newPlay({ level: op.nivel, figures: op.figuras === 'diez' ? 'ten' : 'face', sotaFree: op.sotaLibre, closePenalty: op.cierreCastigo }, bots),
    online: true
  };
  E.dealHand(g);
  g.play.hand.listos = {};
  return g;
}

const mano = g => g.play.hand;
const terminada = g => !!E.compute(g).ended;
const fin = g => { const h = mano(g); if (h && h.phase === 'over' && !h.listos) h.listos = {}; };

function turnoDe(g) {
  const h = mano(g);
  if (!h || h.phase === 'over' || terminada(g)) return null;
  return h.turn;
}

function jugada(g, pid, a) {
  const h = mano(g);
  if (!h || !a || typeof a !== 'object') return 'Jugada no válida';
  E.usePlayRules(g);
  if (a.tipo === 'reclamar') {                       // fuera de turno: cualquiera menos quien lo olvidó
    if (h.phase !== 'play' || !h.forgot) return 'Ya no se puede reclamar';
    if (h.forgot.pid === pid) return 'No puedes reclamarte a ti mismo';
    if (!h.order.includes(pid)) return 'Estás eliminado en esta mano';
    return E.claimPumba(g, pid) ? null : 'Ya no se puede reclamar';
  }
  if (a.tipo === 'echar') {
    if (h.phase !== 'play' || h.turn !== pid) return 'No es tu turno';
    const c = String(a.carta || '');
    if (!h.hands[pid].includes(c)) return 'No tienes esa carta';
    if (!E.canPlay(g, h, c)) return h.penalty ? 'Solo puedes responder con un 2 o robar' : 'Esa carta no coincide en palo ni en número';
    const palo = ['o', 'c', 'e', 'b'].includes(a.palo) ? a.palo : null;
    if (!E.playCard(g, pid, c, palo, !!a.pumba)) return 'Jugada no válida';
    h.nueva = null; fin(g);
    return null;
  }
  if (a.tipo === 'robar') {
    if (h.phase !== 'play' || h.turn !== pid) return 'No es tu turno';
    const antes = h.hands[pid].length;
    if (!E.drawTurn(g, pid)) return 'No puedes robar ahora';
    h.nueva = h.hands[pid].length > antes ? { pid, cartas: h.hands[pid].slice(antes) } : null;
    fin(g);
    return null;
  }
  if (a.tipo === 'reenganche') {
    if (h.phase !== 'over') return 'Solo al terminar la mano';
    const R = E.compute(g);
    if (!E.canRebuy(g, R, pid)) return 'No puedes reengancharte';
    g.events.push({ t: 'rebuy', p: pid, score: E.rebuyScore(g, R), at: Date.now() });
    h.listos[pid] = true;
    return null;
  }
  if (a.tipo === 'listo') {
    if (h.phase !== 'over') return null;
    h.listos[pid] = true;
    return null;
  }
  return 'Jugada no válida';
}

// La máquina mueve por un bot o por alguien desconectado
function pasoAuto(g) {
  const h = mano(g);
  if (!h || h.phase === 'over') return;
  const nivel = g.play.level;
  if (!g.play.bots.includes(h.turn)) g.play.level = 'normal';
  E.botStep(g);
  g.play.level = nivel;
  h.nueva = null;
  fin(g);
}
// Si alguien ha olvidado decir «¡Pumba!», la máquina espera un poco más para dejar reclamar a las personas
const pausaBot = g => { const h = mano(g); return h && h.forgot ? PAUSA_RECLAMAR_MS : 0; };

function esperaListos(g, humanosConectados) {
  const h = mano(g);
  if (!h || h.phase !== 'over' || terminada(g)) return false;
  return !esperados(g, humanosConectados).every(pid => h.listos && h.listos[pid]);
}
// A quién se espera al terminar la mano: a los que siguen jugando y a los recién eliminados que pueden reengancharse.
// Al que estaba ya eliminado (o no puede reengancharse) no se le espera.
function esperados(g, humanos) {
  const h = mano(g), R = E.compute(g);
  return humanos.filter(pid => h.order.includes(pid) && (!R.st[pid].out || E.canRebuy(g, R, pid)));
}
function siguienteMano(g) {
  if (terminada(g)) return false;
  E.botRebuys(g);                                     // la máquina decide si se reengancha
  if (terminada(g)) return false;
  E.dealHand(g);
  g.play.hand.listos = {};
  return true;
}

function vista(g, yo) {
  const h = mano(g), R = E.compute(g);
  E.usePlayRules(g);
  const over = h && h.phase === 'over';
  const miTurno = h && !over && h.turn === yo;
  const out = {
    mano: R.hand + (over ? 0 : 1),
    fase: h ? h.phase : null,
    turno: h ? h.turn : null,
    turnos: h ? h.turns : 0,
    sentido: h ? h.dir : 1,
    palo: h ? h.suit : null,
    castigo: h ? h.penalty : 0,
    mesa: h ? h.pile[h.pile.length - 1] : null,
    mazo: h ? h.deck.length : 0,
    log: h ? h.log : '',
    olvido: h && h.forgot ? h.forgot.pid : null,
    miMano: h && h.hands[yo] && h.order.includes(yo) ? h.hands[yo].slice() : null,
    jugables: miTurno ? E.playable(g, h, yo) : [],
    nueva: h && h.nueva && h.nueva.pid === yo ? h.nueva.cartas : null,
    da: h ? h.dealer : null,
    limite: g.cfg.limit,
    reglas: { figuras: g.play.figures === 'ten' ? 'diez' : 'cara', sotaLibre: g.play.sotaFree !== false, cierreCastigo: g.play.closePenalty !== false, reenganches: g.cfg.maxRebuys },
    jugadores: g.players.map(p => ({
      id: p.id, nombre: p.name, bot: g.play.bots.includes(p.id),
      total: R.st[p.id].total, fuera: R.st[p.id].out, reenganches: R.st[p.id].rebuys,
      cartas: h && h.hands[p.id] && h.order.includes(p.id) ? h.hands[p.id].length : 0,
      enMano: !!(h && h.order.includes(p.id))
    })),
    historial: R.rows.filter(r => r.type === 'hand').map(r => ({ n: r.n, cierra: r.e.closer, puntos: r.applied })),
    resultado: null, listos: over ? Object.keys(h.listos || {}) : [], esperan: over ? esperados(g, g.players.map(p => p.id).filter(id => !g.play.bots.includes(id))) : [],
    puedeReenganchar: false, puntosReenganche: 0,
    fin: R.ended ? { ganador: R.ended.winner, por: R.ended.by } : null,
    partida: null
  };
  if (over) {
    const r = h.result;
    out.resultado = { cierra: r.closer, puntos: r.scores, victima: r.victim || null, extra: r.extra || 0,
      manos: Object.fromEntries(h.order.map(pid => [pid, h.hands[pid].slice()])) };
    if (!R.ended && E.canRebuy(g, R, yo) && !(h.listos || {})[yo]) { out.puedeReenganchar = true; out.puntosReenganche = E.rebuyScore(g, R); }
  }
  if (R.ended) out.partida = { id: g.id, created: g.created, cfg: g.cfg, players: g.players, firstDealer: g.firstDealer, events: g.events, bots: g.play.bots };
  return out;
}

module.exports = { id, min, max, opciones, iniciar, turnoDe, jugada, pasoAuto, pausaBot, esperaListos, siguienteMano, vista, terminada };
