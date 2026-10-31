'use strict';
/*
 * Chinchón en línea. El estado es la misma "partida" de la app (g), con g.play.hand.
 * Cada asiento de la sala es un jugador (id p1…p4). Los bots usan el nivel normal.
 */
const { chinchon: E } = require('../motor');

const id = 'chinchon';
const min = 2, max = 4;

function opciones(o) {
  o = o || {};
  const n = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, Math.round(+v))) : d);
  return {
    limite: n(o.limite, 50, 500, 100),
    cerrarDesde: n(o.cerrarDesde, 1, 3, 2),
    comodines: n(o.comodines, 0, 2, 0),
    nivel: ['facil', 'normal', 'dificil'].includes(o.nivel) ? o.nivel : 'normal'
  };
}

function iniciar(sala) {
  const op = sala.opciones;
  const players = sala.asientos.map(a => ({ id: a.id, name: a.nombre }));
  const g = {
    id: sala.codigo + '-' + Date.now().toString(36), created: Date.now(),
    cfg: Object.assign({}, E.DEF_CFG, { limit: op.limite }),
    players, firstDealer: players[Math.floor(Math.random() * players.length)].id, events: [],
    play: { level: op.nivel, jokers: op.comodines, jokerValue: 0, closeFrom: op.cerrarDesde, bots: sala.asientos.filter(a => a.bot).map(a => a.id), hand: null },
    online: true
  };
  E.dealHand(g);
  g.play.hand.listos = {};
  return g;
}

const mano = g => g.play.hand;
const terminada = g => !!E.compute(g).ended;

// Quién tiene que mover ahora (null si nadie: mano terminada o partida acabada)
function turnoDe(g) {
  const h = mano(g);
  if (!h || h.phase === 'over' || terminada(g)) return null;
  return h.turn;
}

function jugada(g, pid, a) {
  const h = mano(g);
  if (!h || !a || typeof a !== 'object') return 'Jugada no válida';
  E.usePlayRules(g);
  if (a.tipo === 'robar') {
    if (h.phase !== 'draw' || h.turn !== pid) return 'No es tu turno';
    const src = a.de === 'descarte' ? 'discard' : 'deck';
    if (src === 'discard' && !h.discard.length) return 'No hay descarte';
    const c = E.drawFrom(h, src, pid);
    h.hands[pid].push(c);
    h.phase = 'discard';
    h.nueva = { pid, carta: c };
    h.log = E.pname(g, pid) + (src === 'discard' ? ' coge ' + E.theCard(E.card(c)) + ' del descarte.' : ' roba del mazo.');
    return null;
  }
  if (a.tipo === 'tirar') {
    if (h.phase !== 'discard' || h.turn !== pid) return 'No es tu turno';
    const d = String(a.carta || '');
    if (!h.hands[pid].includes(d)) return 'No tienes esa carta';
    const rest = h.hands[pid].filter(x => x !== d);
    if (a.cerrar) {
      if (!E.canCloseNow(g)) return 'Aún no se puede cerrar: desde la ' + E.closeFrom(g) + 'ª vuelta';
      if (E.bestMelds(rest).dead > E.CLOSE_MAX) return 'Para cerrar necesitas ' + E.CLOSE_MAX + ' o menos sin ligar';
      h.hands[pid] = rest;
      E.closeHand(g, pid, d);
      h.listos = {};
      const k = h.result.kind;
      h.log = E.pname(g, pid) + ' cierra' + (k === 'chinchon' ? ' ¡con CHINCHÓN!' : k === 'bonus' ? ' con todo ligado.' : '.');
      return null;
    }
    h.hands[pid] = rest;
    h.discard.push(d); (h.gone = h.gone || []).push(d);
    h.log = E.pname(g, pid) + ' tira ' + E.theCard(E.card(d)) + '.';
    h.nueva = null;
    E.nextTurn(h);
    if (h.turns > 400) { E.closeHand(g, null, null); h.listos = {}; }
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
  if (!g.play.bots.includes(h.turn)) g.play.level = 'normal';   // por un humano ausente juega el nivel normal
  E.botStep(g);
  g.play.level = nivel;
  h.nueva = null;
  if (h.phase === 'over') h.listos = {};
}

// Mano terminada: ¿se puede repartir la siguiente? (todos los humanos conectados han pulsado «Seguir»)
function esperaListos(g, humanosConectados) {
  const h = mano(g);
  if (!h || h.phase !== 'over' || terminada(g)) return false;
  return !humanosConectados.every(pid => h.listos && h.listos[pid]);
}
function siguienteMano(g) {
  if (terminada(g)) return false;
  E.dealHand(g);
  g.play.hand.listos = {};
  return true;
}

function vista(g, yo) {
  const h = mano(g), R = E.compute(g);
  const over = h && h.phase === 'over';
  const out = {
    mano: R.hand + (over ? 0 : 1),
    fase: h ? h.phase : null,
    turno: h ? h.turn : null,
    ronda: h ? E.roundOf(h) : 0,
    turnos: h ? h.turns : 0,
    cerrarDesde: E.closeFrom(g),
    log: h ? h.log : '',
    mazo: h ? h.deck.length : 0,
    descarte: h && h.discard.length ? h.discard[h.discard.length - 1] : null,
    miMano: h && h.hands[yo] ? h.hands[yo].slice() : null,
    nueva: h && h.nueva && h.nueva.pid === yo ? h.nueva.carta : null,
    da: h ? h.dealer : null,
    limite: g.cfg.limit,
    comodines: g.play.jokers,
    jugadores: g.players.map(p => ({
      id: p.id, nombre: p.name, bot: g.play.bots.includes(p.id),
      total: R.st[p.id].total, fuera: R.st[p.id].out, reenganches: R.st[p.id].rebuys,
      cartas: h && h.hands[p.id] && h.order.includes(p.id) ? h.hands[p.id].length : 0
    })),
    historial: R.rows.filter(r => r.type === 'hand').map(r => ({ n: r.n, cierra: r.e.closer, tipo: r.e.kind, puntos: r.applied })),
    resultado: null, listos: over ? Object.keys(h.listos || {}) : [],
    puedeReenganchar: false, puntosReenganche: 0,
    fin: R.ended ? { ganador: R.ended.winner, por: R.ended.by } : null,
    partida: null
  };
  if (over) {
    out.resultado = {
      cierra: h.result.closer, tipo: h.result.kind, puntos: h.result.scores,
      manos: Object.fromEntries(h.order.map(pid => [pid, h.hands[pid].slice()]))
    };
    if (!R.ended && E.canRebuy(g, R, yo) && !(h.listos || {})[yo]) { out.puedeReenganchar = true; out.puntosReenganche = E.rebuyScore(g, R); }
  }
  if (R.ended) out.partida = { id: g.id, created: g.created, cfg: g.cfg, players: g.players, firstDealer: g.firstDealer, events: g.events, bots: g.play.bots };
  return out;
}

module.exports = { id, min, max, opciones, iniciar, turnoDe, jugada, pasoAuto, esperaListos, siguienteMano, vista, terminada };
