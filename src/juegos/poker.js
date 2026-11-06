'use strict';
/*
 * Póker (Texas Hold'em sin límite, torneo freezeout con fichas ficticias) en línea, de 2 a 9 jugadores.
 * Cada silla de la sala (p1…pN) es un asiento de la mesa. El mazo lo baraja el servidor con números
 * aleatorios criptográficos y cada jugador solo recibe sus cartas (y las de quien llega al showdown).
 * La máquina juega en las sillas de bot y por quien se queda sin conexión o se pasa del tiempo.
 * Las reglas son las de la app (motores/poker/poker.js).
 */
const path = require('path');
const MOTORES = process.env.MOTORES_DIR || path.join(__dirname, '..', '..', 'motores');
const P = require(path.join(MOTORES, 'poker', 'poker.js'));

const id = 'poker';
const min = 2, max = 9;
const revancha = true;
const NIVELES = { facil: 1, normal: 2, dificil: 3 };
const F = +process.env.POKER_RITMO_MS || 0;         // (solo para las pruebas) fija el tiempo de turno
const RITMOS = { relajado: F || 60000, normal: F || 40000, rapido: F || 20000 };
const FICHAS = [1000, 1500, 3000];
const MANOS = [5, 10, 15];

function opciones(o) {
  o = o || {};
  return {
    nivel: NIVELES[o.nivel] ? o.nivel : 'normal',
    fichas: FICHAS.includes(+o.fichas) ? +o.fichas : 1500,
    manosNivel: MANOS.includes(+o.manosNivel) ? +o.manosNivel : 10,
    ritmo: RITMOS[o.ritmo] ? o.ritmo : 'normal'
  };
}

function iniciar(sala) {
  const op = sala.opciones;
  const ids = sala.asientos.map(a => a.id);
  const rot = (sala.ronda || 0);
  // en cada revancha se mezcla el orden de los asientos
  const orden = ids.map((_, k) => k);
  if (rot) { const q = rot % ids.length; orden.push(...orden.splice(0, q)); }
  const idsRot = orden.map(k => ids[k]);
  const nombres = orden.map(k => sala.asientos[k].nombre);
  const bots = orden.map(k => !!sala.asientos[k].bot);
  const motor = P.nueva({ nombres, bots, fichas: op.fichas, manosNivel: op.manosNivel });
  return {
    id: sala.codigo + '-' + Date.now().toString(36), created: Date.now(),
    nivel: NIVELES[op.nivel] || 2, ritmo: RITMOS[op.ritmo] || RITMOS.normal,
    ids: idsRot, motor, listos: {}, reloj: null, fuera: []
  };
}

const terminada = g => g.motor.fase === 'fin';
const idx = (g, pid) => g.ids.indexOf(pid);
function turnoDe(g) {
  const m = g.motor;
  if (terminada(g) || m.turno == null) return null;
  return g.ids[m.turno];
}

function jugada(g, pid, a) {
  if (!a || typeof a !== 'object') return 'Jugada no válida';
  const m = g.motor;
  if (a.tipo === 'seguir') {                          // «Seguir» tras terminar la mano
    if (m.fase !== 'mano_fin') return 'La mano aún no ha terminado';
    g.listos[pid] = true; return null;
  }
  if (a.tipo === 'revancha') return null;             // lo gestiona salas.js
  if (terminada(g)) return 'La partida ha terminado';
  const i = idx(g, pid);
  if (i < 0) return 'No estás en esta mesa';
  if (!['fold', 'check', 'call', 'raise', 'allin'].includes(a.tipo)) return 'Jugada no válida';
  const r = P.accion(m, i, { tipo: a.tipo, a: Number(a.a) });
  g.reloj = null;
  return r;
}

// La máquina (y quien se ausenta): decide como un bot del nivel de la sala
function pasoAuto(g) {
  const m = g.motor;
  if (terminada(g) || m.turno == null) return;
  const i = m.turno;
  const nivel = m.seats[i].bot ? g.nivel : 2;
  const a = P.elegir(m, i, nivel);
  if (P.accion(m, i, a)) { const L = P.legal(m, i); P.accion(m, i, L.check ? { tipo: 'check' } : { tipo: 'fold' }); }
  g.reloj = null;
}

/* Reloj de turno para quien está conectado pero no juega: pasa (check) o se retira (fold) */
function limiteTurno(g) {
  const pid = turnoDe(g); if (!pid) return null;
  if (!g.reloj || g.reloj.pid !== pid) g.reloj = { pid, hasta: Date.now() + g.ritmo };
  return Math.max(0, g.reloj.hasta - Date.now());
}
function alAgotarse(g) {
  const m = g.motor, i = m.turno; if (i == null) return;
  const L = P.legal(m, i);
  P.accion(m, i, L.check ? { tipo: 'check' } : { tipo: 'fold' });
  g.reloj = null;
}

// Mano terminada: se espera a que los humanos conectados pulsen «Seguir» (o se reparte sola pasado un rato)
function esperaListos(g, humanos) {
  if (g.motor.fase !== 'mano_fin') return false;
  return !humanos.every(pid => g.listos[pid]);
}
function siguienteMano(g) {
  if (!P.siguienteMano(g.motor)) return false;
  g.listos = {}; g.reloj = null;
  return true;
}

function alSalir(g, pid) {
  const i = idx(g, pid); if (i < 0) return;
  g.motor.seats[i].bot = true;                        // su silla pasa a la máquina
}

function vista(g, yoPid) {
  const m = g.motor, yo = idx(g, yoPid);
  const v = P.vista(m, yo >= 0 ? yo : -1);
  v.yo = yo >= 0 ? yo : null;
  v.ids = g.ids.slice(); v.turnoSilla = turnoDe(g);
  v.listos = Object.keys(g.listos); v.ritmo = g.ritmo;
  limiteTurno(g);
  v.venceEn = g.reloj && m.turno != null && !m.seats[m.turno].bot ? g.reloj.hasta : null;
  v.resta = v.venceEn ? Math.max(0, v.venceEn - Date.now()) : null;   // el reloj del servidor puede no coincidir con el del móvil
  v.nivelBot = g.nivel;
  if (terminada(g)) v.partida = { id: g.id, created: g.created, nombres: m.seats.map(s => s.nombre), bots: m.seats.map(s => s.bot), orden: m.orden.slice(), manos: m.mano, fichas: m.cfg.fichas };
  return v;
}

module.exports = { id, min, max, revancha, opciones, iniciar, turnoDe, jugada, pasoAuto, esperaListos, siguienteMano, vista, terminada, alSalir, limiteTurno, alAgotarse };
