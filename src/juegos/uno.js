'use strict';
/*
 * UNO en línea, de 2 a 10 jugadores. Cada silla de la sala (p1…pN) es un asiento de la mesa.
 * El mazo lo baraja el servidor con números aleatorios criptográficos y cada jugador solo recibe sus cartas.
 * La máquina juega en las sillas de bot y por quien se queda sin conexión o se pasa del tiempo.
 * Las reglas son las de la app (motores/uno/uno.js): hoja oficial de Mattel + opciones (acumular, 7-0, castigo de 2 o 4).
 */
const path = require('path');
const MOTORES = process.env.MOTORES_DIR || path.join(__dirname, '..', '..', 'motores');
const U = require(path.join(MOTORES, 'uno', 'uno.js'));

const id = 'uno';
const min = 2, max = 10;
const revancha = true;
const NIVELES = { facil: 1, normal: 2, dificil: 3 };
const F = +process.env.UNO_RITMO_MS || 0;           // (solo para las pruebas) fija el tiempo de turno
const RITMOS = { relajado: F || 60000, normal: F || 40000, rapido: F || 20000 };
const METAS = [0, 200, 500, 1000];

function opciones(o) {
  o = o || {};
  return {
    nivel: NIVELES[o.nivel] ? o.nivel : 'normal',
    meta: METAS.includes(+o.meta) ? +o.meta : 500,
    acum: !!o.acum, siete0: !!o.siete0, penal: +o.penal === 2 ? 2 : 4,
    ritmo: RITMOS[o.ritmo] ? o.ritmo : 'normal'
  };
}

function iniciar(sala) {
  const op = sala.opciones;
  const ids = sala.asientos.map(a => a.id);
  const rot = (sala.ronda || 0);
  const orden = ids.map((_, k) => k);
  if (rot) { const q = rot % ids.length; orden.push(...orden.splice(0, q)); }     // en cada revancha cambia quién reparte
  const idsRot = orden.map(k => ids[k]);
  const nombres = orden.map(k => sala.asientos[k].nombre);
  const bots = orden.map(k => !!sala.asientos[k].bot);
  const motor = U.nueva({ nombres, bots, meta: op.meta, acum: op.acum, siete0: op.siete0, penal: op.penal });
  return {
    id: sala.codigo + '-' + Date.now().toString(36), created: Date.now(),
    nivel: NIVELES[op.nivel] || 2, ritmo: RITMOS[op.ritmo] || RITMOS.normal,
    ids: idsRot, motor, listos: {}, reloj: null
  };
}

const terminada = g => g.motor.fase === 'fin';
const idx = (g, pid) => g.ids.indexOf(pid);
function turnoDe(g) {
  const m = g.motor;
  if (terminada(g) || m.fase !== 'jugando' || m.turno == null) return null;
  return g.ids[m.turno];
}

function jugada(g, pid, a) {
  if (!a || typeof a !== 'object') return 'Jugada no válida';
  const m = g.motor;
  if (a.tipo === 'seguir') {                          // «Seguir» tras terminar la mano
    if (m.fase !== 'ronda_fin') return 'La mano aún no ha terminado';
    g.listos[pid] = true; return null;
  }
  if (a.tipo === 'revancha') return null;             // lo gestiona salas.js
  if (terminada(g)) return 'La partida ha terminado';
  const i = idx(g, pid);
  if (i < 0) return 'No estás en esta mesa';
  if (!['jugar', 'robar', 'pasar', 'retar', 'color', 'pillar', 'uno'].includes(a.tipo)) return 'Jugada no válida';
  const r = U.accion(m, i, { tipo: a.tipo, carta: Number(a.carta), color: a.color == null ? undefined : Number(a.color), uno: !!a.uno, objetivo: a.objetivo == null ? undefined : Number(a.objetivo) });
  if (!r && (a.tipo !== 'pillar' && a.tipo !== 'uno')) g.reloj = null;
  return r;
}

// La máquina (y quien se ausenta): decide como un bot del nivel de la sala
function pasoAuto(g) {
  const m = g.motor;
  if (terminada(g) || m.fase !== 'jugando' || m.turno == null) return;
  const i = m.turno;
  const nivel = m.seats[i].bot ? g.nivel : 2;
  const a = U.elegir(m, i, nivel);
  if (U.accion(m, i, a)) { if (U.accion(m, i, { tipo: 'robar' })) U.accion(m, i, { tipo: 'color', color: 0 }); if (m.drawn != null && m.turno === i) U.accion(m, i, { tipo: 'pasar' }); }
  g.reloj = null;
}
// Si alguien se ha dejado el UNO, la máquina espera un poco para que los demás puedan pillarle
function pausaBot(g) { return g.motor.expuesto && !g.motor.seats[g.motor.expuesto.i].bot ? 1500 : 0; }

/* Reloj de turno para quien está conectado pero no juega: roba (y pasa) solo */
function limiteTurno(g) {
  const pid = turnoDe(g); if (!pid) return null;
  if (!g.reloj || g.reloj.pid !== pid) g.reloj = { pid, hasta: Date.now() + g.ritmo };
  return Math.max(0, g.reloj.hasta - Date.now());
}
function alAgotarse(g) {
  const m = g.motor, i = m.turno; if (i == null || m.fase !== 'jugando') return;
  if (m.eligeColor) U.accion(m, i, { tipo: 'color', color: 0 });
  else { U.accion(m, i, { tipo: 'robar' }); if (m.drawn != null && m.turno === i) U.accion(m, i, { tipo: 'pasar' }); }
  g.reloj = null;
}

// Mano terminada: se espera a que los humanos conectados pulsen «Seguir» (o se reparte sola pasado un rato)
function esperaListos(g, humanos) {
  if (g.motor.fase !== 'ronda_fin') return false;
  return !humanos.every(pid => g.listos[pid]);
}
function siguienteMano(g) {
  if (!U.siguienteRonda(g.motor)) return false;
  g.listos = {}; g.reloj = null;
  return true;
}

function alSalir(g, pid) {
  const i = idx(g, pid); if (i < 0) return;
  g.motor.seats[i].bot = true;                        // su silla pasa a la máquina
}

function vista(g, yoPid) {
  const m = g.motor, yo = idx(g, yoPid);
  const v = U.vista(m, yo >= 0 ? yo : -1);
  v.yo = yo >= 0 ? yo : null;
  v.ids = g.ids.slice(); v.turnoSilla = turnoDe(g);
  v.listos = Object.keys(g.listos); v.ritmo = g.ritmo;
  limiteTurno(g);
  v.venceEn = g.reloj && m.turno != null && m.fase === 'jugando' && !m.seats[m.turno].bot ? g.reloj.hasta : null;
  v.resta = v.venceEn ? Math.max(0, v.venceEn - Date.now()) : null;
  v.nivelBot = g.nivel;
  if (terminada(g)) v.partida = { id: g.id, created: g.created, nombres: m.seats.map(s => s.nombre), bots: m.seats.map(s => s.bot), orden: m.orden.slice(), manos: m.ronda, meta: m.cfg.meta, puntos: m.seats.map(s => s.puntos) };
  return v;
}

module.exports = { id, min, max, revancha, opciones, iniciar, turnoDe, jugada, pasoAuto, pausaBot, esperaListos, siguienteMano, vista, terminada, alSalir, limiteTurno, alAgotarse };
