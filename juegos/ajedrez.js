// Módulo de Ajedrez para el servidor de juegos en línea (IT Canarias).
// Usa las mismas reglas que la app (compartido/ajedrez.js): el servidor valida cada jugada.
// Asiento 0 = blancas, asiento 1 = negras.
'use strict';
const A = require('../compartido/ajedrez.js');
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function reloj(op) {
  const r = op && op.reloj;
  if (!r || typeof r !== 'object') return null;
  const base = Math.round(Number(r.base)), inc = Math.round(Number(r.inc) || 0);
  if (!Number.isFinite(base) || base < 30000 || base > 3 * 3600e3) return null;
  return { base, inc: Math.max(0, Math.min(60000, inc)) };
}
function posicion(e) { return A.replay(e.moves, e.startFen).pos; }
function restante(e, c, ahora) {
  if (!e.clock) return null;
  const vivo = !e.result && e.tick && posicion(e).turn === c;
  return Math.max(0, e.times[c] - (vivo ? ahora - e.tick : 0));
}
function terminar(e, result, reason, ahora) {
  if (e.result) return;
  if (e.clock && e.tick) { const c = posicion(e).turn; e.times[c] = restante(e, c, ahora); }
  e.result = result; e.reason = reason; e.tick = null; e.drawOffer = null;
}

module.exports = {
  id: 'ajedrez',
  nombre: 'Ajedrez',
  jugadores: 2,
  // Asiento del que crea la sala: elige blancas, negras o al azar
  asientoCreador(op) { const c = op && op.color; return c === 'b' ? 1 : c === 'w' ? 0 : (Math.random() < 0.5 ? 0 : 1); },
  iniciar(op) {
    const clock = reloj(op);
    return { moves: [], startFen: null, clock, times: clock ? [clock.base, clock.base] : null, tick: null, result: null, reason: '', drawOffer: null };
  },
  turno(e) { return posicion(e).turn; },
  fin(e) { return !!e.result; },
  jugada(e, asiento, u, ahora) {
    if (e.result) return { error: 'La partida ha terminado' };
    if (typeof u !== 'string' || !UCI.test(u)) return { error: 'Jugada no válida' };
    const pos = posicion(e);
    if (pos.turn !== asiento) return { error: 'No es tu turno' };
    if (!pos.fromUci(u)) return { error: 'Jugada ilegal' };
    if (e.clock) {
      if (e.tick && restante(e, asiento, ahora) <= 0) { this.comprobarTiempo(e, ahora); return { error: 'Se acabó el tiempo' }; }
      if (e.tick) e.times[asiento] = restante(e, asiento, ahora);
      if (e.moves.length || asiento === 1) e.times[asiento] += e.clock.inc;
      e.tick = ahora;
    }
    e.moves.push(u);
    e.drawOffer = null;
    const st = A.status(posicion(e));
    if (st.over) terminar(e, st.result, st.reason, ahora);
    return { ok: true };
  },
  accion(e, asiento, accion, ahora) {
    if (e.result) return { error: 'La partida ha terminado' };
    if (accion === 'rendirse') { terminar(e, asiento === 0 ? '0-1' : '1-0', 'abandono', ahora); return { ok: true }; }
    if (accion === 'tablas') {
      if (e.drawOffer === 1 - asiento) { terminar(e, '1/2-1/2', 'acuerdo', ahora); return { ok: true }; }
      if (e.moves.length < 2) return { error: 'Aún no se pueden ofrecer tablas' };
      e.drawOffer = asiento; return { ok: true };
    }
    if (accion === 'rechazar') { if (e.drawOffer === 1 - asiento) e.drawOffer = null; return { ok: true }; }
    return { error: 'Acción desconocida' };
  },
  // Milisegundos hasta que caiga la bandera del que juega (o null si no hay reloj en marcha)
  tiempoHastaBandera(e, ahora) { if (!e.clock || !e.tick || e.result) return null; return restante(e, posicion(e).turn, ahora); },
  comprobarTiempo(e, ahora) {
    if (!e.clock || !e.tick || e.result) return false;
    const pos = posicion(e), c = pos.turn;
    if (restante(e, c, ahora) > 0) return false;
    e.times[c] = 0;
    terminar(e, pos.canMate(1 - c) ? (c === 0 ? '0-1' : '1-0') : '1/2-1/2', 'tiempo', ahora);
    return true;
  },
  // Lo que ve cada jugador (en ajedrez no hay nada oculto). Los relojes van como tiempo restante en este momento.
  vista(e, asiento, ahora) {
    return { moves: e.moves, startFen: e.startFen, clock: e.clock, times: e.clock ? [restante(e, 0, ahora), restante(e, 1, ahora)] : null, running: !!(e.clock && e.tick && !e.result), result: e.result, reason: e.reason, drawOffer: e.drawOffer };
  },
};
