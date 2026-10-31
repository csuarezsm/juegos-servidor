'use strict';
/*
 * Ajedrez en línea. Usa las mismas reglas que la app (motores/ajedrez/ajedrez.js).
 * Sillas p1 (quien crea la sala) y p2. El color lo elige quien crea; en cada revancha se cambian.
 * Sin máquina: si alguien se desconecta se le espera (su reloj sigue corriendo).
 */
const { ajedrez: A } = require('../motor');

const id = 'ajedrez';
const min = 2, max = 2;
const sinMaquina = true;     // no se puede añadir a la máquina ni juega por los ausentes
const autoEmpezar = true;    // empieza sola al entrar el segundo jugador
const revancha = true;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function opciones(o) {
  o = o || {};
  const color = ['w', 'b', 'r'].includes(o.color) ? o.color : 'r';
  let reloj = null;
  if (o.reloj && typeof o.reloj === 'object') {
    const base = Math.round(+o.reloj.base), inc = Math.round(+o.reloj.inc || 0);
    if (Number.isFinite(base) && base >= 30000 && base <= 3 * 3600e3) reloj = { base, inc: Math.max(0, Math.min(60000, inc)) };
  }
  return { color, reloj };
}

function iniciar(sala) {
  const op = sala.opciones, ronda = sala.ronda || 0;
  if (op.color === 'r' && !sala.colorAzar) sala.colorAzar = Math.random() < 0.5 ? 'w' : 'b';
  const c = op.color === 'r' ? sala.colorAzar : op.color;
  let blancas = c === 'w' ? 'p1' : 'p2';
  if (ronda % 2) blancas = blancas === 'p1' ? 'p2' : 'p1';
  const negras = blancas === 'p1' ? 'p2' : 'p1';
  const clock = op.reloj;
  return { moves: [], startFen: null, clock, times: clock ? [clock.base, clock.base] : null, tick: null,
    result: null, reason: '', drawOffer: null, blancas, negras, ronda };
}

const pos = g => A.replay(g.moves, g.startFen).pos;
const colorDe = (g, pid) => pid === g.blancas ? 0 : pid === g.negras ? 1 : -1;
const silla = (g, c) => c === 0 ? g.blancas : g.negras;
function restante(g, c, ahora) {
  if (!g.clock) return null;
  const vivo = !g.result && g.tick && pos(g).turn === c;
  return Math.max(0, g.times[c] - (vivo ? ahora - g.tick : 0));
}
function terminar(g, result, reason, ahora) {
  if (g.result) return;
  if (g.clock && g.tick) { const c = pos(g).turn; g.times[c] = restante(g, c, ahora); }
  g.result = result; g.reason = reason; g.tick = null; g.drawOffer = null;
}

const terminada = g => !!g.result;
function turnoDe(g) { return g.result ? null : silla(g, pos(g).turn); }

function jugada(g, pid, a, ahora) {
  ahora = ahora || Date.now();
  if (!a || typeof a !== 'object') return 'Jugada no válida';
  if (g.result) return 'La partida ha terminado';
  const c = colorDe(g, pid);
  if (c < 0) return 'No juegas en esta partida';
  if (a.tipo === 'mover') {
    const u = String(a.uci || '');
    if (!UCI.test(u)) return 'Jugada no válida';
    const p = pos(g);
    if (p.turn !== c) return 'No es tu turno';
    if (!p.fromUci(u)) return 'Jugada ilegal';
    if (g.clock) {
      if (g.tick && restante(g, c, ahora) <= 0) { alVencer(g, ahora); return 'Se acabó el tiempo'; }
      if (g.tick) g.times[c] = restante(g, c, ahora);
      if (g.moves.length || c === 1) g.times[c] += g.clock.inc;
      g.tick = ahora;
    }
    g.moves.push(u); g.drawOffer = null;
    const st = A.status(pos(g));
    if (st.over) terminar(g, st.result, st.reason, ahora);
    return null;
  }
  if (a.tipo === 'rendirse') { terminar(g, c === 0 ? '0-1' : '1-0', 'abandono', ahora); return null; }
  if (a.tipo === 'tablas') {
    if (g.drawOffer === 1 - c) { terminar(g, '1/2-1/2', 'acuerdo', ahora); return null; }
    if (g.moves.length < 2) return 'Aún no se pueden ofrecer tablas';
    g.drawOffer = c; return null;
  }
  if (a.tipo === 'rechazar') { if (g.drawOffer === 1 - c) g.drawOffer = null; return null; }
  return 'Jugada no válida';
}

// Reloj: milisegundos hasta que caiga la bandera del que juega (null si no hay reloj en marcha)
function reloj(g, ahora) { if (!g.clock || !g.tick || g.result) return null; return restante(g, pos(g).turn, ahora || Date.now()); }
function alVencer(g, ahora) {
  ahora = ahora || Date.now();
  if (!g.clock || !g.tick || g.result) return false;
  const p = pos(g), c = p.turn;
  if (restante(g, c, ahora) > 0) return false;
  g.times[c] = 0;
  terminar(g, p.canMate(1 - c) ? (c === 0 ? '0-1' : '1-0') : '1/2-1/2', 'tiempo', ahora);
  return true;
}
function alSalir(g, pid) { const c = colorDe(g, pid); if (c >= 0 && !g.result) terminar(g, c === 0 ? '0-1' : '1-0', 'abandono', Date.now()); }

function vista(g, yo) {
  const ahora = Date.now();
  return { moves: g.moves.slice(), startFen: g.startFen, blancas: g.blancas, negras: g.negras, miColor: colorDe(g, yo),
    clock: g.clock, times: g.clock ? [restante(g, 0, ahora), restante(g, 1, ahora)] : null, running: !!(g.clock && g.tick && !g.result),
    result: g.result, reason: g.reason, drawOffer: g.drawOffer, ronda: g.ronda };
}

const pasoAuto = () => {};
const esperaListos = () => false;
const siguienteMano = () => false;

module.exports = { id, min, max, sinMaquina, autoEmpezar, revancha, opciones, iniciar, turnoDe, jugada, pasoAuto, esperaListos, siguienteMano, vista, terminada, reloj, alVencer, alSalir };
